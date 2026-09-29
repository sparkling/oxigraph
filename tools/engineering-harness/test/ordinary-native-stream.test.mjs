import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ordinaryClaudeStreamArgs, ordinaryStreamLimits, startOrdinaryClaudeStream, forwardOrdinaryStreamSignals } from "../src/native/ordinary-stream.mjs";

const secret = "PRIVATE_prompt_reasoning_tool_credential";
const prelude = `
const emit = x => process.stdout.write(JSON.stringify(x)+'\\n');
const delta = (type, key, value) => emit({type:'stream_event',event:{type:'content_block_delta',delta:{type,[key]:value}}});
const finish = () => {emit({type:'result',session_id:'fake-session',structured_output:{verdict:'ACCEPT'}});};
process.stdin.resume();
`;
function fixture(t, code, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ordinary-stream-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const progressPath = join(dir, "progress.jsonl");
  const execution = startOrdinaryClaudeStream({
    executable: process.execPath, args: ["-e", prelude + code], cwd: dir,
    environment: { PATH: process.env.PATH }, stdin: secret,
    identity: { taskId: "task-stream", runId: "run-stream", requestId: 7 },
    progressPath,
    ...options,
    limits: { warnMs: 300, cancelMs: 800, termGraceMs: 100, drainMs: 1000, progressMs: 50, ...options.limits },
  });
  t.after(() => execution.cancel());
  return { ...execution, dir, progressPath,
    records: () => readFileSync(progressPath, "utf8").trim().split("\n").map(JSON.parse) };
}
function assertSafe(records) {
  assert.ok(!JSON.stringify(records).includes(secret));
  const keys = ["schema", "taskId", "runId", "requestId", "pid", "type", "at", "elapsedMs", "inactiveMs", "activityCount", "stdoutBytes", "stderrBytes", "disposition"];
  for (const record of records) assert.deepEqual(Object.keys(record).sort(), [...keys].sort());
}

test("ordinary defaults and stream argv preserve all native route arguments", () => {
  assert.equal(ordinaryStreamLimits.warnMs, 120000);
  assert.equal(ordinaryStreamLimits.cancelMs, 300000);
  const args = ["--model", "cc/claude-sonnet-5-5[1m]", "--effort", "high", "--output-format", "json", "--tools", ""];
  assert.deepEqual(ordinaryClaudeStreamArgs(args), [...args.slice(0, 5), "stream-json", ...args.slice(6), "--verbose", "--include-partial-messages"]);
  assert.equal(args[5], "json");
  assert.throws(() => ordinaryClaudeStreamArgs([]), /one JSON/);
});

for (const [type, key] of [["text_delta", "text"], ["thinking_delta", "thinking"], ["input_json_delta", "partial_json"]]) {
  test(`healthy ${type} keeps request alive beyond inactivity bound without body leakage`, async t => {
    const run = fixture(t, `
      let n = 0;
      const timer = setInterval(() => {
        delta('${type}', '${key}', '${secret}');
        if (++n === 12) {clearInterval(timer); finish();}
      }, 100);
    `);
    const result = await run.completion;
    assert.equal(result.disposition, "completed");
    assert.equal(result.exitCode, 0);
    assert.equal(result.custodyReleased, true);
    assert.equal(result.activityCount, 12);
    assert.ok(result.durationMs > 800);
    assert.ok(!result.stdout.includes(secret));
    assert.equal(JSON.parse(result.stdout).session_id, "fake-session");
    assertSafe(run.records());
    assert.equal(statSync(run.progressPath).mode & 0o777, 0o600);
  });
}

test("pings, stderr, empty deltas and unknown bytes cannot prevent warned stall", async t => {
  const run = fixture(t, `setInterval(() => {
    emit({type:'ping',text:'${secret}'});
    emit({type:'unknown',delta:{type:'thinking_delta',thinking:'${secret}'}});
    delta('text_delta','text','');
    delta('unknown_delta','text','${secret}');
    process.stdout.write('unrecognized ${secret}\\n');
    process.stderr.write('${secret}'.repeat(100));
  }, 10);`, { limits: { maxStderrBytes: 128 } });
  const result = await run.completion;
  assert.equal(result.disposition, "stalled");
  assert.equal(result.activityCount, 0);
  assert.equal(result.custodyReleased, true);
  assert.ok(Buffer.byteLength(result.stderr) <= 128);
  assert.equal(result.stderrTruncated, true);
  const records = run.records();
  assert.equal(records.filter(x => x.type === "inactivity-warning").length, 1);
  assert.ok(records.some(x => x.type === "stopping" && x.disposition === "stalled"));
  assertSafe(records);
});

test("redacted thinking estimates sustain only an active thinking block", async t => {
  const run = fixture(t, `
    const send = event => emit({type:'stream_event', event});
    send({type:'content_block_start',index:0,content_block:{type:'thinking'}});
    let n=0;
    const timer=setInterval(() => {
      send({type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'',estimated_tokens:32}});
      if (++n===12) {clearInterval(timer); finish();}
    },100);
  `);
  const result = await run.completion;
  assert.equal(result.disposition, "completed");
  assert.equal(result.activityCount, 12);
  assertSafe(run.records());
});

test("invalid and unframed reasoning estimates cannot prevent stall", async t => {
  const run = fixture(t, `
    const send = event => emit({type:'stream_event',event});
    send({type:'content_block_start',index:0,content_block:{type:'thinking'}});
    setInterval(() => {
      for (const estimated_tokens of [0,-1,0.5,'32',null,9007199254740992]) {
        send({type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'',estimated_tokens}});
      }
      send({type:'content_block_delta',index:1,delta:{type:'thinking_delta',thinking:'',estimated_tokens:32}});
      emit({type:'system',estimated_tokens:32});
    },50);
  `);
  const result = await run.completion;
  assert.equal(result.disposition, "stalled");
  assert.equal(result.activityCount, 0);
  assert.equal(result.custodyReleased, true);
  assertSafe(run.records());
});

for (const boundary of [{type:"content_block_stop",index:0}, {type:"message_stop"},
  {type:"message_start"}, {type:"content_block_start",index:0,content_block:{type:"text"}}]) {
  test(`reasoning estimates after ${JSON.stringify(boundary)} cannot prevent stall`, async t => {
    const run = fixture(t, `
      const send = event => emit({type:'stream_event',event});
      send({type:'content_block_start',index:0,content_block:{type:'thinking'}});
      send(${JSON.stringify(boundary)});
      setInterval(() => send({type:'content_block_delta',index:0,
        delta:{type:'thinking_delta',thinking:'',estimated_tokens:32}}),50);
    `);
    const result = await run.completion;
    assert.equal(result.disposition, "stalled");
    assert.equal(result.activityCount, 0);
    assert.equal(result.custodyReleased, true);
  });
}

test("warning clears only after substantive activity and idle clock restarts", async t => {
  const run = fixture(t, `setTimeout(() => delta('thinking_delta','thinking','${secret}'), 450); setInterval(() => emit({type:'ping'}), 30);`);
  const result = await run.completion;
  assert.equal(result.disposition, "stalled");
  assert.equal(result.activityCount, 1);
  assert.ok(result.durationMs >= 1200);
  assert.equal(run.records().filter(x => x.type === "inactivity-warning").length, 2);
  assert.ok(run.records().some(x => x.type === "activity-resumed"));
});

test("AbortSignal drains TERM-resistant process using bounded KILL", async t => {
  const controller = new AbortController();
  const run = fixture(t, `process.on('SIGTERM',()=>{}); setInterval(()=>delta('text_delta','text','${secret}'),40);`, { signal: controller.signal });
  const timeout = setTimeout(() => controller.abort(), 400);
  t.after(() => clearTimeout(timeout));
  const result = await run.completion;
  assert.equal(result.disposition, "cancelled");
  assert.equal(result.signal, "SIGKILL");
  assert.equal(result.custodyReleased, true);
  assert.ok(run.records().some(x => x.type === "kill"));
  assertSafe(run.records());
});

test("dead leader cannot hide live descendant retaining pipes", async t => {
  const run = fixture(t, `
    const {spawn}=require('node:child_process');
    const descendant=spawn(process.execPath,['-e', "process.on('SIGTERM',()=>{}); process.stdout.write('ready\\\\n'); setInterval(()=>{},1000)"], {stdio:['ignore','pipe','inherit']});
    descendant.stdout.once('data',()=>{require('node:fs').writeFileSync('descendant.pid',String(descendant.pid)); process.exit(0);});
  `);
  const result = await run.completion;
  assert.equal(result.disposition, "descendant-retained");
  assert.ok(run.records().some(x => x.type === "kill"));
  const pid = Number(readFileSync(join(run.dir, "descendant.pid")));
  // Unreaped orphan zombies retain custody, never become successful completion.
  try { assert.match(readFileSync(`/proc/${pid}/stat`, "utf8"), /^\d+ \(.*\) Z /); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  assert.equal(result.custodyReleased, result.reaped && result.closed && result.groupQuiescent);
  assert.equal(result.custodyReleased, true);
});

test("record limit bounds even unterminated stdout and preserves failure", async t => {
  const run = fixture(t, `process.stdout.write('x'.repeat(100000)); setInterval(()=>{},1000);`, { limits: { maxRecordBytes: 1024 } });
  const result = await run.completion;
  assert.equal(result.disposition, "output-limit");
  assert.equal(result.stdout, "");
  assert.equal(result.custodyReleased, true);
});

test("chunked UTF-8 NDJSON keeps only unique terminal envelope", async t => {
  const run = fixture(t, `
    const data=Buffer.from(JSON.stringify({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:'\\u00e9'}}})+'\\n');
    for(const byte of data) process.stdout.write(Buffer.from([byte]));
    emit({type:'assistant',message:{content:[{type:'thinking',thinking:'${secret}'}]}});
    finish();
  `);
  const result = await run.completion;
  assert.equal(result.disposition, "completed");
  assert.equal(result.activityCount, 1);
  assert.ok(!result.stdout.includes(secret));
  assertSafe(run.records());
});

test("duplicate terminal result is invalid, not a successful candidate", async t => {
  const run = fixture(t, "finish(); finish();");
  assert.equal((await run.completion).disposition, "invalid-output");
});

test("pre-cancel and spawn error report locally without subscription-outage classification", async t => {
  const controller = new AbortController(); controller.abort();
  const cancelled = fixture(t, "throw new Error('must not spawn')", { signal: controller.signal });
  assert.equal(cancelled.pid, null);
  assert.equal((await cancelled.completion).disposition, "cancelled");
  const missing = fixture(t, "", { executable: "/does-not-exist-native-fixture" });
  const result = await missing.completion;
  assert.equal(result.disposition, "spawn-error");
  assert.equal(result.spawnErrorCode, "ENOENT");
  assert.equal(result.custodyReleased, true);
});

test("full stderr digest covers bytes beyond bounded private capture", async t => {
  const data = secret.repeat(100);
  const run = fixture(t, `process.stderr.write('${data}'); finish();`, { limits: { maxStderrBytes: 16 } });
  const result = await run.completion;
  assert.equal(result.stderr, data.slice(0, 16));
  assert.equal(result.stderrBytes, Buffer.byteLength(data));
  assert.equal(result.stderrSha256, createHash("sha256").update(data).digest("hex"));
  assertSafe(run.records());
});

test("escaped descendant retaining a pipe cannot release custody at drain deadline", async t => {
  const controller = new AbortController();
  let escapeePid;
  const run = fixture(t, `
    const {spawn}=require('node:child_process');
    const descendant=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)"],{detached:true,stdio:['ignore',process.stdout,'ignore']});
    require('node:fs').writeFileSync('escapee.pid',String(descendant.pid));
    process.exit(0);
  `, { signal: controller.signal });
  t.after(() => {
    if (escapeePid === undefined) return;
    try { process.kill(-escapeePid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
  });
  setTimeout(() => controller.abort(), 400);
  const result = await run.completion;
  escapeePid = Number(readFileSync(join(run.dir, "escapee.pid")));
  assert.equal(result.disposition, "cancelled");
  assert.equal(result.closed, false);
  assert.equal(result.custodyReleased, false);
  assert.ok(result.durationMs >= 1400);
});

test("deep terminal JSON fails boundedly instead of throwing from child callback", async t => {
  const run = fixture(t, `process.stdout.write('{"type":"result","structured_output":'+'['.repeat(12000)+'0'+']'.repeat(12000)+'}\\n'); setInterval(()=>{},1000);`);
  const result = await run.completion;
  assert.equal(result.disposition, "invalid-output");
  assert.equal(result.custodyReleased, true);
});

test("limit, identity and journal exclusivity checks reject before spawn", t => {
  for (const limits of [{extra:1}, {warnMs:1.5}, {cancelMs:300}, {termGraceMs:1000}]) {
    assert.throws(() => fixture(t, "", { limits }), /Invalid ordinary stream limits/);
  }
  for (const taskId of ["bad/path", "x".repeat(129), undefined, "bad\nvalue"]) {
    assert.throws(() => fixture(t, "", { identity: {taskId, runId:"run", requestId:1} }), /identity/);
  }
  const dir = mkdtempSync(join(tmpdir(), "ordinary-exclusive-"));
  t.after(() => rmSync(dir, { recursive:true, force:true }));
  const progressPath = join(dir, "progress.jsonl"); writeFileSync(progressPath, "original");
  assert.throws(() => fixture(t, "", { progressPath }), { code:"EEXIST" });
  assert.equal(readFileSync(progressPath, "utf8"), "original");
});

async function hostFixture(t, code) {
  const dir = mkdtempSync(join(tmpdir(), "ordinary-host-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const url = new URL("../src/native/ordinary-stream.mjs", import.meta.url).href;
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import fs from 'node:fs';
    import {syncBuiltinESMExports} from 'node:module';
    const options={executable:process.execPath,args:['-e','process.stdin.resume();setInterval(()=>{},1000)'],cwd:process.cwd(),environment:{PATH:process.env.PATH},stdin:'',identity:{taskId:'fixture',runId:'fixture',requestId:1},progressPath:'progress.jsonl',limits:{warnMs:300,cancelMs:800,termGraceMs:100,drainMs:1000}};
    ${code.replaceAll("HELPER_URL", JSON.stringify(url))}
  `], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  let stdout="",stderr="";
  child.stdout.on("data", bytes => {stdout+=bytes;});
  child.stderr.on("data", bytes => {stderr+=bytes;});
  const timer=setTimeout(()=>child.kill("SIGKILL"),5000);
  const exit=await new Promise(resolve=>child.on("close",resolve));
  clearTimeout(timer);
  assert.equal(exit,0,stderr);
  return {dir,stdout};
}

test("journal write failure stops group and retains progress-io-error", async t => {
  const host=await hostFixture(t, `
    fs.fsyncSync=()=>{throw Object.assign(new Error('full'),{code:'ENOSPC'});};syncBuiltinESMExports();
    const {startOrdinaryClaudeStream}=await import(HELPER_URL);
    const execution=startOrdinaryClaudeStream(options);
    console.log(JSON.stringify(await execution.completion));
  `);
  const result=JSON.parse(host.stdout);
  assert.equal(result.disposition,"progress-io-error");
  assert.equal(result.journalFailed,true);
  assert.equal(result.custodyReleased,true);
});

test("SIGHUP forwarding cancels and detaches only after confirmed custody release", async t => {
  const run=fixture(t,"setInterval(()=>{},1000);");
  const count=process.listenerCount("SIGHUP");
  forwardOrdinaryStreamSignals(run);
  process.emit("SIGHUP");
  const result=await run.completion;
  assert.equal(result.disposition,"cancelled");
  assert.equal(result.custodyReleased,true);
  assert.equal(process.listenerCount("SIGHUP"),count);
});

test("host early exit performs synchronous group KILL, not orphaning child", async t => {
  const host=await hostFixture(t, `
    const {startOrdinaryClaudeStream,forwardOrdinaryStreamSignals}=await import(HELPER_URL);
    const execution=startOrdinaryClaudeStream(options);forwardOrdinaryStreamSignals(execution);
    fs.writeFileSync('child.pid',String(execution.pid));
    setTimeout(()=>process.exit(0),150);
  `);
  const pid=Number(readFileSync(join(host.dir,"child.pid")));
  try { assert.match(readFileSync(`/proc/${pid}/stat`,"utf8"),/^\d+ \(.*\) Z /); }
  catch(error){if(error.code!=="ENOENT")throw error;}
});

test("genuine tool start and matching result sustain liveness without leaking bodies", async t => {
  const run = fixture(t, `
    let n=0;
    const timer=setInterval(()=>{
      const id='call-'+Math.floor(n/2);
      if(n%2===0) emit({type:'stream_event',event:{type:'content_block_start',content_block:{type:'tool_use',id,name:'tool',input:{secret:'${secret}'}}}});
      else emit({type:'user',message:{content:[{type:'tool_result',tool_use_id:id,content:'${secret}'}]}});
      if(++n===12){clearInterval(timer);finish();}
    },100);
  `);
  const result=await run.completion;
  assert.equal(result.disposition,"completed");
  assert.equal(result.activityCount,12);
  assert.ok(result.durationMs>800);
  assertSafe(run.records());
  assert.ok(!result.stdout.includes(secret));
});

test("duplicate tool starts, tool-progress heartbeat and unmatched results cannot fake activity", async t => {
  const run=fixture(t, `
    setInterval(()=>{
      emit({type:'assistant',message:{content:[{type:'tool_use',id:'one',name:'tool',input:{secret:'${secret}'}}]}});
      emit({type:'tool_progress',tool_use_id:'one',elapsed_time_seconds:1});
      emit({type:'user',message:{content:[{type:'tool_result',tool_use_id:'unknown',content:'${secret}'}]}});
    },40);
  `);
  const result=await run.completion;
  assert.equal(result.disposition,"stalled");
  assert.equal(result.activityCount,1);
  assertSafe(run.records());
});

test("progress observer exceptions drain child instead of orphaning it", async t => {
  const run=fixture(t,"setInterval(()=>{},1000);",{onProgress:()=>{throw new Error(secret);}});
  const result=await run.completion;
  assert.equal(result.disposition,"progress-observer-error");
  assert.equal(result.custodyReleased,true);
  assertSafe(run.records());
});
