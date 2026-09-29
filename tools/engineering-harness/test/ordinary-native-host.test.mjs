import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { runOrdinaryClaudeRequest } from "../src/native/ordinary-host.mjs";
import { nativeChildEnvironment } from "../src/native/environment.mjs";

const secret="PRIVATE_prompt_reasoning_tool_error";
function setup(t, code) {
  const directory=mkdtempSync(join(tmpdir(),"ordinary-host-integration-"));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const path=join(directory,"fake-claude.mjs");
  writeFileSync(path,`#!${process.execPath}\nimport fs from 'node:fs';
    fs.writeFileSync('actual.json',JSON.stringify({argv:process.argv.slice(2),outputLimit:process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS}));
    const emit=event=>process.stdout.write(JSON.stringify(event)+'\\n');
    process.stdin.resume();
    ${code}\n`,{mode:0o700});
  const request={schema:1,runId:randomUUID(),requestId:1,taskId:"task-fixture",specSha256:"spec",sourceSha256:"source",action:"native-worker",
    payload:{route:{transport:"native-subscription",role:"review",model:"cc/claude-sonnet-5-5[1m]",effort:"high"},files:[]}};
  const requestPath=join(directory,"request.json");writeFileSync(requestPath,JSON.stringify(request));
  const records=[];
  const args={request,requestPath,prompt:secret,directory,driverUrl:new URL(import.meta.url),reads:[],readSource:{head:"fixture"},
    resolveExecutable:()=>({path,sha256:createHash("sha256").update(readFileSync(path)).digest("hex")}),
    streamLimits:{warnMs:150,cancelMs:400,termGraceMs:50,drainMs:1000,progressMs:50},observation:value=>records.push(value)};
  return {args,records,directory,read:name=>JSON.parse(readFileSync(join(directory,name),"utf8"))};
}

test("tracked adapter reproduces real driver argv/environment, hashes and exact response identity",async t=>{
  const fixture=setup(t,`emit({type:'stream_event',event:{type:'content_block_delta',delta:{type:'thinking_delta',thinking:'${secret}'}}});
    emit({type:'result',session_id:'fixture-worker',structured_output:{summary:'reviewed',verdict:'ACCEPT',findings:[],changes:[]}});`);
  const result=await runOrdinaryClaudeRequest(fixture.args);
  assert.equal(result.status,"completed");
  const {payload,action,...identity}=fixture.args.request;
  const response=fixture.read("response.json");
  assert.deepEqual({...response,result:undefined},{...identity,result:undefined});
  assert.equal(response.result.workerId,"fixture-worker");
  const actual=fixture.read("actual.json"),start=fixture.read("start.json");
  assert.equal(actual.argv[actual.argv.indexOf("--output-format")+1],"stream-json");
  assert.ok(actual.argv.includes("--include-partial-messages"));
  assert.ok(actual.argv.includes("--verbose"));
  assert.deepEqual(actual.argv,start.argv);
  assert.equal(actual.outputLimit,nativeChildEnvironment("claude").CLAUDE_CODE_MAX_OUTPUT_TOKENS);
  assert.equal(start.outputLimit,Number(actual.outputLimit));
  for(const field of ["driverSha256","hostHelperSha256","streamHelperSha256","executableSha256","requestSha256"]) assert.match(start[field],/^[a-f0-9]{64}$/);
  assert.equal(fixture.read("terminal.json").custodyReleased,true);
  assert.ok(!JSON.stringify(fixture.records).includes(secret));
  assert.ok(!readFileSync(join(fixture.directory,"progress.jsonl"),"utf8").includes(secret));
});

test("visible console events warn and stall while failed receipts stay distinct from outage",async t=>{
  const fixture=setup(t,`setInterval(()=>{emit({type:'ping',text:'${secret}'});process.stderr.write('${secret}');},20);`);
  const output=[];
  const original=console.log;
  console.log=line=>output.push(line);
  t.after(()=>{console.log=original;});
  const result=await runOrdinaryClaudeRequest({...fixture.args,observation:undefined});
  console.log=original;
  assert.equal(result.status,"failed");
  assert.equal(result.failure.classification,"stalled");
  assert.equal(result.failure.custodyReleased,true);
  assert.equal(existsSync(join(fixture.directory,"response.json")),false);
  assert.equal(fixture.read("failure.json").classification,"stalled");
  const events=output.map(JSON.parse);
  assert.ok(events.some(x=>x.type==="native-progress"&&x.event==="inactivity-warning"));
  assert.ok(events.some(x=>x.type==="native-progress"&&x.event==="stopping"&&x.disposition==="stalled"));
  assert.ok(events.some(x=>x.type==="native-end"&&x.status==="failed"));
  assert.ok(!output.join("\n").includes(secret));
});

test("subscription error stays exact in private response but redacted in console",async t=>{
  const fixture=setup(t,`emit({type:'result',session_id:'fixture',is_error:true,result:'API Error: 401 ${secret}'});process.exitCode=1;`);
  const result=await runOrdinaryClaudeRequest(fixture.args);
  assert.equal(result.status,"unavailable");
  assert.equal(result.response.result.error,`API Error: 401 ${secret}`);
  assert.equal(fixture.read("response.json").result.error,result.response.result.error);
  assert.ok(!JSON.stringify(fixture.records).includes(secret));
  assert.equal(fixture.records.filter(x=>x.type==="native-start").length,1);
});

test("host observation throw drains native group and records only error digest",async t=>{
  const fixture=setup(t,"setInterval(()=>{},1000);");
  await assert.rejects(runOrdinaryClaudeRequest({...fixture.args,observation:event=>{if(event.type==="native-start")throw new Error(secret);}}),new RegExp(secret));
  const start=fixture.read("start.json");
  assert.throws(()=>process.kill(-start.pid,0),{code:"ESRCH"});
  assert.equal(fixture.read("validation-error.json").classification,"host-validation-error");
  assert.ok(!readFileSync(join(fixture.directory,"validation-error.json"),"utf8").includes(secret));
});

test("stderr-only native nonzero exit preserves exact unavailable error, not stall",async t=>{
  const fixture=setup(t,`process.stderr.write('API Error: 503 ${secret}');process.exitCode=1;`);
  const result=await runOrdinaryClaudeRequest(fixture.args);
  assert.equal(result.status,"unavailable");
  assert.equal(result.response.result.error,`API Error: 503 ${secret}`);
  assert.ok(!JSON.stringify(fixture.records).includes(secret));
});

test("structural output ceiling is failed output-limit, never outage or completed proposal",async t=>{
  const fixture=setup(t,"process.stdout.write('x'.repeat(2048));setInterval(()=>{},1000);");
  fixture.args.streamLimits.maxRecordBytes=1024;
  const result=await runOrdinaryClaudeRequest(fixture.args);
  assert.equal(result.status,"failed");
  assert.equal(result.failure.classification,"output-limit");
  assert.equal(existsSync(join(fixture.directory,"response.json")),false);
  assert.equal(result.terminal.custodyReleased,true);
});

test("explicit native output-token ceiling retains existing capability failure classification",async t=>{
  const fixture=setup(t,"emit({type:'result',session_id:'fixture-worker',is_error:true,result:'response exceeded the output token maximum'});process.exitCode=1;");
  const result=await runOrdinaryClaudeRequest(fixture.args);
  assert.equal(result.status,"completed");
  assert.equal(result.classification,"output-token-limit");
  assert.equal(result.response.result.verdict,"INCONCLUSIVE");
  assert.equal(fixture.records.filter(x=>x.type==="native-start").length,1);
});

for (const script of [
  `process.stderr.write('JSON parse failed ${secret}');process.exitCode=1;`,
  `emit({type:'result',session_id:'fixture',is_error:true,result:'structured output validation failed ${secret}'});process.exitCode=1;`,
]) test("generic client failure is retained locally, not inferred subscription outage",async t=>{
  const fixture=setup(t,script);
  const result=await runOrdinaryClaudeRequest(fixture.args);
  assert.equal(result.status,"failed");
  assert.equal(result.failure.classification,"native-client-error");
  assert.match(result.failure.error,new RegExp(secret));
  assert.equal(existsSync(join(fixture.directory,"response.json")),false);
  assert.ok(!JSON.stringify(fixture.records).includes(secret));
});

test("signal exit after terminal bytes cannot become subscription outage or success",async t=>{
  const fixture=setup(t,"emit({type:'result',session_id:'fixture',structured_output:{summary:'ok',verdict:'ACCEPT',findings:[],changes:[]}});process.kill(process.pid,'SIGTERM');");
  const result=await runOrdinaryClaudeRequest(fixture.args);
  assert.equal(result.status,"failed");
  assert.equal(result.failure.classification,"native-signal-exit");
  assert.equal(existsSync(join(fixture.directory,"response.json")),false);
});

test("malformed structured result retains validation failure, not unavailable response",async t=>{
  const fixture=setup(t,"emit({type:'result',session_id:'fixture',result:'not JSON'});");
  await assert.rejects(runOrdinaryClaudeRequest(fixture.args),SyntaxError);
  assert.equal(fixture.read("validation-error.json").classification,"host-validation-error");
  assert.equal(existsSync(join(fixture.directory,"response.json")),false);
  assert.equal(fixture.read("terminal.json").custodyReleased,true);
});

test("signal exit without terminal envelope is local signal failure",async t=>{
  const fixture=setup(t,"process.kill(process.pid,'SIGTERM');");
  const result=await runOrdinaryClaudeRequest(fixture.args);
  assert.equal(result.status,"failed");
  assert.equal(result.failure.classification,"native-signal-exit");
  assert.equal(result.failure.error,"SIGTERM");
});

test("stderr output-token error without worker identity cannot fabricate completed proposal",async t=>{
  const fixture=setup(t,"process.stderr.write('response exceeded the output token maximum');process.exitCode=1;");
  const result=await runOrdinaryClaudeRequest(fixture.args);
  assert.equal(result.status,"failed");
  assert.equal(result.failure.classification,"output-token-limit");
  assert.equal(existsSync(join(fixture.directory,"response.json")),false);
});
