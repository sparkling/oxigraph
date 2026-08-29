/*
 * Dormant candidate-containment supervisor artifact.
 *
 * This freestanding Linux/x86-64 source intentionally implements no request
 * parser, status writer, or containment/launch mechanic. Its only reachable
 * entry fails closed with exit_group(125). The
 * embedded canonical self-description is attested externally and does not
 * authorize execution or containment.
 */

#if !defined(__linux__) || !defined(__x86_64__)
#error "candidate containment supervisor v1 requires Linux x86-64"
#endif

__attribute__((
    section(".rodata.oxigraph_containment_supervisor"),
    used,
    aligned(1)
))
const char oxigraph_containment_supervisor_self_description[] =
    "{\"artifact\":\"candidate-containment-supervisor-v1\",\"binding\":null,\"childPayloadFds\":[3,4,5,6,7,8,9,10],\"dormantExitCode\":125,\"entry\":\"oxigraph_supervisor_dormant_entry\",\"fdMapSchema\":\"oxigraph.candidate-containment-supervisor-fd-map/v1\",\"fdMapSha256\":\"2902c184d2e637fe2ddd7be071f17835a600b2aa1327f735112be6af11d7e2b2\",\"firstUnexpectedSupervisorFd\":15,\"mechanicsImplemented\":false,\"physicalLaunchEligible\":false,\"requestMaximumBytes\":4096,\"requestParserImplemented\":false,\"requestSchema\":\"oxigraph.candidate-containment-supervisor-request/v1\",\"requirementsSha256\":\"0038bf47eaa152ede4f404aa808ca6ccc98ca65649011ab5dd251fb82eefd158\",\"schema\":\"oxigraph.candidate-containment-supervisor-self-description/v1\",\"statusMaximumBytes\":65536,\"statusMaximumFrameBytes\":4096,\"statusMaximumFrames\":10,\"statusSchema\":\"oxigraph.candidate-containment-supervisor-status/v1\",\"statusTimeoutMilliseconds\":2000,\"statusWriterImplemented\":false,\"supervisorPayloadFds\":[7,8,9,10,11,12,13,14],\"target\":\"linux-x86_64-freestanding-static\"}\n";

__attribute__((noreturn, used))
void oxigraph_supervisor_dormant_entry(void) {
    register long syscall_number __asm__("rax") = 231L;
    register long exit_status __asm__("rdi") = 125L;
    __asm__ volatile(
        "syscall"
        :
        : "a"(syscall_number), "D"(exit_status)
        : "rcx", "r11", "memory"
    );
    __builtin_unreachable();
}
