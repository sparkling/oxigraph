/*
 * Authority-null candidate containment supervisor preflight.
 *
 * This freestanding Linux/x86-64 program performs only the bounded protocol
 * and descriptor preflight needed to prove that an executable supervisor can
 * reach a cancel-only terminal state. It does not clone, execute a candidate,
 * interpret cgroupfs, mutate a journal, or confer runtime/qualification
 * authority. Static attestation and native execution evidence are deliberately
 * separate artifacts.
 */

#if !defined(__linux__) || !defined(__x86_64__)
#error "candidate containment supervisor preflight requires Linux x86-64"
#endif

typedef unsigned char ox_u8;
typedef unsigned int ox_u32;
typedef unsigned long ox_u64;
typedef signed long ox_i64;
typedef unsigned long ox_usize;

#define OX_SYS_read 0L
#define OX_SYS_write 1L
#define OX_SYS_close 3L
#define OX_SYS_fstat 5L
#define OX_SYS_rt_sigaction 13L
#define OX_SYS_fcntl 72L
#define OX_SYS_exit_group 231L
#define OX_SYS_close_range 436L

#define OX_EINTR 4L
#define OX_F_GETFD 1L
#define OX_F_GETFL 3L
#define OX_O_ACCMODE 3L
#define OX_O_RDONLY 0L
#define OX_O_WRONLY 1L
#define OX_O_RDWR 2L
#define OX_O_PATH 010000000L
#define OX_S_IFMT 0170000U
#define OX_S_IFIFO 0010000U
#define OX_S_IFDIR 0040000U
#define OX_S_IFREG 0100000U
#define OX_SIGPIPE 13L
#define OX_SIG_IGN 1UL

#define OX_START_MAX 8192UL
#define OX_CAPSULE_FRAME_MAX 131072UL
#define OX_CAPSULE_RAW_MAX 65536UL
#define OX_CONTROL_MAX 4096UL
#define OX_STATUS_MAX 8192UL
#define OX_FIELD_MAX 40UL
#define OX_JSON_DEPTH_MAX 24U

static const char ox_preflight_requirements_sha256[] =
    "47e429123d0a74dbbd6d8d82f4b5d0c62d565674868f5424df0e2f46b717dbc4";
static const char ox_launch_requirements_sha256[] =
    "4432b3334ff07b847f1ee8abe49c184df5c993545c21f405ccc1247ecb20604a";
static const char ox_fd_map_sha256[] =
    "82794bfb6c3e99eb773d7c944e6622769a28002b7170a6a202d7fe30b211f05f";
static const char ox_remap_plan_sha256[] =
    "f432ec6f1ef0d3efdfd46d8972f489aacc8179bac27d23e54b98ef0dd369a8db";

static const ox_u8 ox_failure_diagnostic[16] = {
    'P', 'R', 'E', 'F', 'L', 'I', 'G', 'H',
    'T', '_', 'F', 'A', 'I', 'L', '!', '\n'
};

__attribute__((
    section(".rodata.oxigraph_containment_supervisor_preflight"),
    used,
    aligned(1)
))
const char oxigraph_containment_supervisor_preflight_self_description[] =
    "{\"allowedSyscalls\":[\"read\",\"write\",\"close\",\"fstat\",\"fcntl\",\"rt_sigaction\",\"close_range\",\"exit_group\"],\"artifact\":\"candidate-containment-supervisor-preflight-v1\",\"authority\":{\"applicationReceiptAuthority\":false,\"applicationResultAuthority\":false,\"containmentExecutionAuthority\":false,\"descriptorAuthority\":false,\"filesystemDurabilityAuthority\":false,\"finalDecisionAuthority\":false,\"guardianAuthority\":false,\"nativeObservationAuthority\":false,\"productionContainment\":false,\"promotionAuthority\":false,\"publicationAuthority\":false,\"qualificationAuthority\":false,\"reapAuthority\":false,\"runtimeRegistrationAuthority\":false,\"sandboxReportAuthority\":false,\"supervisorAuthority\":false},\"binding\":null,\"cancelOnlyTerminalWriterImplemented\":true,\"candidateExecutionImplemented\":false,\"canonicalCapsuleEnvelopeParserImplemented\":true,\"canonicalStartParserImplemented\":true,\"cgroupMechanicsImplemented\":false,\"cloneImplemented\":false,\"commandEofRequiredAfterCancel\":true,\"descriptorPreflightImplemented\":true,\"descriptorThreeSemantics\":\"opaque-read-only-directory-only\",\"descriptorsClosedBeforeReadyFrom\":18,\"diagnosticSinkValidatedBeforeFailureWrite\":true,\"entry\":\"oxigraph_supervisor_preflight_entry\",\"entryStackAlignmentImplemented\":true,\"failureDiagnosticBase64\":\"UFJFRkxJR0hUX0ZBSUwhCg==\",\"failureDiagnosticBytes\":16,\"opathDescriptorsRejected\":true,\"physicalLaunchEligible\":false,\"requirementsSha256\":\"47e429123d0a74dbbd6d8d82f4b5d0c62d565674868f5424df0e2f46b717dbc4\",\"schema\":\"oxigraph.candidate-containment-supervisor-preflight-self-description/v1\",\"sha256Implemented\":true,\"statusEofRequiredAfterFinalStatus\":true,\"strictBase64DecoderImplemented\":true,\"supervisorDescriptorRangeEnd\":17,\"supervisorDescriptorRangeStart\":0,\"target\":\"linux-x86_64-freestanding-static\",\"trailingCommandBytesPermitted\":false}\n";

struct ox_kernel_stat {
    ox_u64 device;
    ox_u64 inode;
    ox_u64 links;
    ox_u32 mode;
    ox_u32 owner_uid;
    ox_u32 owner_gid;
    ox_u32 padding0;
    ox_u64 special_device;
    ox_i64 size;
    ox_i64 block_size;
    ox_i64 blocks;
    ox_u64 accessed_seconds;
    ox_u64 accessed_nanoseconds;
    ox_u64 modified_seconds;
    ox_u64 modified_nanoseconds;
    ox_u64 changed_seconds;
    ox_u64 changed_nanoseconds;
    ox_i64 unused[3];
};

struct ox_kernel_sigaction {
    ox_u64 handler;
    ox_u64 flags;
    ox_u64 restorer;
    ox_u64 mask;
};

static inline long ox_call1(long number, long first) {
    long result;
    __asm__ volatile(
        "syscall"
        : "=a"(result)
        : "a"(number), "D"(first)
        : "rcx", "r11", "memory"
    );
    return result;
}

static inline long ox_call3(long number, long first, long second, long third) {
    long result;
    __asm__ volatile(
        "syscall"
        : "=a"(result)
        : "a"(number), "D"(first), "S"(second), "d"(third)
        : "rcx", "r11", "memory"
    );
    return result;
}

static inline long ox_call4(
    long number,
    long first,
    long second,
    long third,
    long fourth
) {
    register long fourth_register __asm__("r10") = fourth;
    long result;
    __asm__ volatile(
        "syscall"
        : "=a"(result)
        : "a"(number), "D"(first), "S"(second), "d"(third),
          "r"(fourth_register)
        : "rcx", "r11", "memory"
    );
    return result;
}

static long ox_read_fd(int descriptor, ox_u8 *bytes, ox_usize length) {
    return ox_call3(
        OX_SYS_read,
        (long)descriptor,
        (long)(ox_u64)bytes,
        (long)length
    );
}

static long ox_write_fd(int descriptor, const ox_u8 *bytes, ox_usize length) {
    return ox_call3(
        OX_SYS_write,
        (long)descriptor,
        (long)(ox_u64)bytes,
        (long)length
    );
}

static long ox_close_fd(int descriptor) {
    return ox_call1(OX_SYS_close, (long)descriptor);
}

static long ox_fstat_fd(int descriptor, struct ox_kernel_stat *status) {
    return ox_call3(
        OX_SYS_fstat,
        (long)descriptor,
        (long)(ox_u64)status,
        0L
    );
}

static long ox_fcntl_fd(int descriptor, long command) {
    return ox_call3(OX_SYS_fcntl, (long)descriptor, command, 0L);
}

static long ox_ignore_sigpipe(void) {
    struct ox_kernel_sigaction action;
    action.handler = OX_SIG_IGN;
    action.flags = 0UL;
    action.restorer = 0UL;
    action.mask = 0UL;
    return ox_call4(
        OX_SYS_rt_sigaction,
        OX_SIGPIPE,
        (long)(ox_u64)&action,
        0L,
        8L
    );
}

static long ox_close_unexpected_descriptors(void) {
    return ox_call3(OX_SYS_close_range, 18L, 0xffffffffL, 0L);
}

__attribute__((noreturn))
static void ox_exit(int status) {
    (void)ox_call1(OX_SYS_exit_group, (long)status);
    __builtin_unreachable();
}

static ox_usize ox_length(const char *value) {
    ox_usize length = 0UL;
    while (value[length] != '\0') length += 1UL;
    return length;
}

static int ox_bytes_equal(
    const ox_u8 *left,
    const ox_u8 *right,
    ox_usize length
) {
    ox_usize index;
    for (index = 0UL; index < length; index += 1UL) {
        if (left[index] != right[index]) return 0;
    }
    return 1;
}

static int ox_span_compare(
    const ox_u8 *bytes,
    ox_usize left_start,
    ox_usize left_end,
    ox_usize right_start,
    ox_usize right_end
) {
    ox_usize left_length = left_end - left_start;
    ox_usize right_length = right_end - right_start;
    ox_usize shared = left_length < right_length ? left_length : right_length;
    ox_usize index;
    for (index = 0UL; index < shared; index += 1UL) {
        ox_u8 left = bytes[left_start + index];
        ox_u8 right = bytes[right_start + index];
        if (left < right) return -1;
        if (left > right) return 1;
    }
    if (left_length < right_length) return -1;
    if (left_length > right_length) return 1;
    return 0;
}

static int ox_hex_digit(ox_u8 value) {
    return (value >= (ox_u8)'0' && value <= (ox_u8)'9') ||
           (value >= (ox_u8)'a' && value <= (ox_u8)'f');
}

static int ox_utf8_advance(const ox_u8 *bytes, ox_usize length, ox_usize *at) {
    ox_u8 first = bytes[*at];
    ox_usize remaining;
    ox_u32 value;
    ox_u32 minimum;
    ox_usize index;
    if (first < 0x80U) {
        *at += 1UL;
        return 1;
    }
    if (first >= 0xc2U && first <= 0xdfU) {
        remaining = 1UL;
        value = (ox_u32)(first & 0x1fU);
        minimum = 0x80U;
    } else if (first >= 0xe0U && first <= 0xefU) {
        remaining = 2UL;
        value = (ox_u32)(first & 0x0fU);
        minimum = 0x800U;
    } else if (first >= 0xf0U && first <= 0xf4U) {
        remaining = 3UL;
        value = (ox_u32)(first & 0x07U);
        minimum = 0x10000U;
    } else {
        return 0;
    }
    if (*at + remaining >= length) return 0;
    for (index = 1UL; index <= remaining; index += 1UL) {
        ox_u8 next = bytes[*at + index];
        if ((next & 0xc0U) != 0x80U) return 0;
        value = (value << 6U) | (ox_u32)(next & 0x3fU);
    }
    if (
        value < minimum || value > 0x10ffffU ||
        (value >= 0xd800U && value <= 0xdfffU)
    ) {
        return 0;
    }
    *at += remaining + 1UL;
    return 1;
}

struct ox_sha256 {
    ox_u32 state[8];
    ox_u64 byte_count;
    ox_u8 block[64];
    ox_u32 used;
};

static const ox_u32 ox_sha256_round[64] = {
    0x428a2f98U, 0x71374491U, 0xb5c0fbcfU, 0xe9b5dba5U,
    0x3956c25bU, 0x59f111f1U, 0x923f82a4U, 0xab1c5ed5U,
    0xd807aa98U, 0x12835b01U, 0x243185beU, 0x550c7dc3U,
    0x72be5d74U, 0x80deb1feU, 0x9bdc06a7U, 0xc19bf174U,
    0xe49b69c1U, 0xefbe4786U, 0x0fc19dc6U, 0x240ca1ccU,
    0x2de92c6fU, 0x4a7484aaU, 0x5cb0a9dcU, 0x76f988daU,
    0x983e5152U, 0xa831c66dU, 0xb00327c8U, 0xbf597fc7U,
    0xc6e00bf3U, 0xd5a79147U, 0x06ca6351U, 0x14292967U,
    0x27b70a85U, 0x2e1b2138U, 0x4d2c6dfcU, 0x53380d13U,
    0x650a7354U, 0x766a0abbU, 0x81c2c92eU, 0x92722c85U,
    0xa2bfe8a1U, 0xa81a664bU, 0xc24b8b70U, 0xc76c51a3U,
    0xd192e819U, 0xd6990624U, 0xf40e3585U, 0x106aa070U,
    0x19a4c116U, 0x1e376c08U, 0x2748774cU, 0x34b0bcb5U,
    0x391c0cb3U, 0x4ed8aa4aU, 0x5b9cca4fU, 0x682e6ff3U,
    0x748f82eeU, 0x78a5636fU, 0x84c87814U, 0x8cc70208U,
    0x90befffaU, 0xa4506cebU, 0xbef9a3f7U, 0xc67178f2U
};

static ox_u32 ox_rotate_right(ox_u32 value, ox_u32 count) {
    return (value >> count) | (value << (32U - count));
}

static void ox_sha256_transform(struct ox_sha256 *context) {
    ox_u32 words[64];
    ox_u32 a;
    ox_u32 b;
    ox_u32 c;
    ox_u32 d;
    ox_u32 e;
    ox_u32 f;
    ox_u32 g;
    ox_u32 h;
    ox_u32 index;
    for (index = 0U; index < 16U; index += 1U) {
        ox_u32 offset = index * 4U;
        words[index] = ((ox_u32)context->block[offset] << 24U) |
                       ((ox_u32)context->block[offset + 1U] << 16U) |
                       ((ox_u32)context->block[offset + 2U] << 8U) |
                       (ox_u32)context->block[offset + 3U];
    }
    for (index = 16U; index < 64U; index += 1U) {
        ox_u32 first = ox_rotate_right(words[index - 15U], 7U) ^
                       ox_rotate_right(words[index - 15U], 18U) ^
                       (words[index - 15U] >> 3U);
        ox_u32 second = ox_rotate_right(words[index - 2U], 17U) ^
                        ox_rotate_right(words[index - 2U], 19U) ^
                        (words[index - 2U] >> 10U);
        words[index] = words[index - 16U] + first + words[index - 7U] + second;
    }
    a = context->state[0];
    b = context->state[1];
    c = context->state[2];
    d = context->state[3];
    e = context->state[4];
    f = context->state[5];
    g = context->state[6];
    h = context->state[7];
    for (index = 0U; index < 64U; index += 1U) {
        ox_u32 upper = ox_rotate_right(e, 6U) ^ ox_rotate_right(e, 11U) ^
                       ox_rotate_right(e, 25U);
        ox_u32 choose = (e & f) ^ ((~e) & g);
        ox_u32 first = h + upper + choose + ox_sha256_round[index] +
                       words[index];
        ox_u32 lower = ox_rotate_right(a, 2U) ^ ox_rotate_right(a, 13U) ^
                       ox_rotate_right(a, 22U);
        ox_u32 majority = (a & b) ^ (a & c) ^ (b & c);
        ox_u32 second = lower + majority;
        h = g;
        g = f;
        f = e;
        e = d + first;
        d = c;
        c = b;
        b = a;
        a = first + second;
    }
    context->state[0] += a;
    context->state[1] += b;
    context->state[2] += c;
    context->state[3] += d;
    context->state[4] += e;
    context->state[5] += f;
    context->state[6] += g;
    context->state[7] += h;
}

static void ox_sha256_begin(struct ox_sha256 *context) {
    context->state[0] = 0x6a09e667U;
    context->state[1] = 0xbb67ae85U;
    context->state[2] = 0x3c6ef372U;
    context->state[3] = 0xa54ff53aU;
    context->state[4] = 0x510e527fU;
    context->state[5] = 0x9b05688cU;
    context->state[6] = 0x1f83d9abU;
    context->state[7] = 0x5be0cd19U;
    context->byte_count = 0UL;
    context->used = 0U;
}

static void ox_sha256_add(
    struct ox_sha256 *context,
    const ox_u8 *bytes,
    ox_usize length
) {
    ox_usize index;
    for (index = 0UL; index < length; index += 1UL) {
        context->block[context->used] = bytes[index];
        context->used += 1U;
        context->byte_count += 1UL;
        if (context->used == 64U) {
            ox_sha256_transform(context);
            context->used = 0U;
        }
    }
}

static void ox_sha256_finish(struct ox_sha256 *context, ox_u8 output[32]) {
    ox_u64 bit_count = context->byte_count * 8UL;
    ox_u32 index;
    context->block[context->used] = 0x80U;
    context->used += 1U;
    if (context->used > 56U) {
        while (context->used < 64U) {
            context->block[context->used] = 0U;
            context->used += 1U;
        }
        ox_sha256_transform(context);
        context->used = 0U;
    }
    while (context->used < 56U) {
        context->block[context->used] = 0U;
        context->used += 1U;
    }
    for (index = 0U; index < 8U; index += 1U) {
        context->block[56U + index] =
            (ox_u8)(bit_count >> (56U - index * 8U));
    }
    ox_sha256_transform(context);
    for (index = 0U; index < 8U; index += 1U) {
        output[index * 4U] = (ox_u8)(context->state[index] >> 24U);
        output[index * 4U + 1U] = (ox_u8)(context->state[index] >> 16U);
        output[index * 4U + 2U] = (ox_u8)(context->state[index] >> 8U);
        output[index * 4U + 3U] = (ox_u8)context->state[index];
    }
}

static void ox_sha256_hex(
    const ox_u8 *bytes,
    ox_usize length,
    char output[65]
) {
    static const char digits[] = "0123456789abcdef";
    struct ox_sha256 context;
    ox_u8 digest[32];
    ox_u32 index;
    ox_sha256_begin(&context);
    ox_sha256_add(&context, bytes, length);
    ox_sha256_finish(&context, digest);
    for (index = 0U; index < 32U; index += 1U) {
        output[index * 2U] = digits[digest[index] >> 4U];
        output[index * 2U + 1U] = digits[digest[index] & 0x0fU];
    }
    output[64] = '\0';
}

enum ox_json_kind {
    OX_JSON_STRING = 1,
    OX_JSON_NUMBER = 2,
    OX_JSON_OBJECT = 3,
    OX_JSON_ARRAY = 4,
    OX_JSON_LITERAL = 5
};

struct ox_span {
    ox_usize start;
    ox_usize end;
};

struct ox_field {
    struct ox_span key;
    struct ox_span value;
    enum ox_json_kind kind;
};

struct ox_parser {
    const ox_u8 *bytes;
    ox_usize length;
    ox_usize at;
    ox_u32 depth;
};

static int ox_parse_value(
    struct ox_parser *parser,
    enum ox_json_kind *kind,
    struct ox_span *span
);

static int ox_parse_string(struct ox_parser *parser, struct ox_span *content) {
    ox_usize start;
    if (
        parser->at >= parser->length ||
        parser->bytes[parser->at] != (ox_u8)'"'
    ) {
        return 0;
    }
    parser->at += 1UL;
    start = parser->at;
    while (parser->at < parser->length) {
        ox_u8 value = parser->bytes[parser->at];
        if (value == (ox_u8)'"') {
            content->start = start;
            content->end = parser->at;
            parser->at += 1UL;
            return 1;
        }
        if (value < 0x20U) return 0;
        if (value == (ox_u8)'\\') {
            ox_u8 escaped;
            parser->at += 1UL;
            if (parser->at >= parser->length) return 0;
            escaped = parser->bytes[parser->at];
            if (
                escaped == (ox_u8)'"' || escaped == (ox_u8)'\\' ||
                escaped == (ox_u8)'b' || escaped == (ox_u8)'f' ||
                escaped == (ox_u8)'n' || escaped == (ox_u8)'r' ||
                escaped == (ox_u8)'t'
            ) {
                parser->at += 1UL;
                continue;
            }
            if (escaped == (ox_u8)'u') {
                ox_u32 index;
                if (parser->at + 4UL >= parser->length) return 0;
                for (index = 1U; index <= 4U; index += 1U) {
                    if (!ox_hex_digit(parser->bytes[parser->at + index])) {
                        return 0;
                    }
                }
                parser->at += 5UL;
                continue;
            }
            return 0;
        }
        if (value >= 0x80U) {
            if (!ox_utf8_advance(parser->bytes, parser->length, &parser->at)) {
                return 0;
            }
        } else {
            parser->at += 1UL;
        }
    }
    return 0;
}

static int ox_parse_number(struct ox_parser *parser) {
    ox_usize at = parser->at;
    if (at < parser->length && parser->bytes[at] == (ox_u8)'-') at += 1UL;
    if (at >= parser->length) return 0;
    if (parser->bytes[at] == (ox_u8)'0') {
        at += 1UL;
        if (at < parser->length && parser->bytes[at] >= (ox_u8)'0' &&
            parser->bytes[at] <= (ox_u8)'9') {
            return 0;
        }
    } else if (
        parser->bytes[at] >= (ox_u8)'1' &&
        parser->bytes[at] <= (ox_u8)'9'
    ) {
        do {
            at += 1UL;
        } while (
            at < parser->length && parser->bytes[at] >= (ox_u8)'0' &&
            parser->bytes[at] <= (ox_u8)'9'
        );
    } else {
        return 0;
    }
    if (at < parser->length && parser->bytes[at] == (ox_u8)'.') {
        at += 1UL;
        if (
            at >= parser->length || parser->bytes[at] < (ox_u8)'0' ||
            parser->bytes[at] > (ox_u8)'9'
        ) {
            return 0;
        }
        do {
            at += 1UL;
        } while (
            at < parser->length && parser->bytes[at] >= (ox_u8)'0' &&
            parser->bytes[at] <= (ox_u8)'9'
        );
    }
    if (
        at < parser->length &&
        (parser->bytes[at] == (ox_u8)'e' ||
         parser->bytes[at] == (ox_u8)'E')
    ) {
        at += 1UL;
        if (
            at < parser->length &&
            (parser->bytes[at] == (ox_u8)'+' ||
             parser->bytes[at] == (ox_u8)'-')
        ) {
            at += 1UL;
        }
        if (
            at >= parser->length || parser->bytes[at] < (ox_u8)'0' ||
            parser->bytes[at] > (ox_u8)'9'
        ) {
            return 0;
        }
        do {
            at += 1UL;
        } while (
            at < parser->length && parser->bytes[at] >= (ox_u8)'0' &&
            parser->bytes[at] <= (ox_u8)'9'
        );
    }
    parser->at = at;
    return 1;
}

static int ox_parse_array(struct ox_parser *parser) {
    if (parser->depth >= OX_JSON_DEPTH_MAX) return 0;
    parser->depth += 1U;
    parser->at += 1UL;
    if (
        parser->at < parser->length &&
        parser->bytes[parser->at] == (ox_u8)']'
    ) {
        parser->at += 1UL;
        parser->depth -= 1U;
        return 1;
    }
    for (;;) {
        enum ox_json_kind kind;
        struct ox_span span;
        if (!ox_parse_value(parser, &kind, &span)) return 0;
        if (parser->at >= parser->length) return 0;
        if (parser->bytes[parser->at] == (ox_u8)']') {
            parser->at += 1UL;
            parser->depth -= 1U;
            return 1;
        }
        if (parser->bytes[parser->at] != (ox_u8)',') return 0;
        parser->at += 1UL;
    }
}

static int ox_parse_object_fields(
    struct ox_parser *parser,
    struct ox_field *fields,
    ox_usize capacity,
    ox_usize *count
) {
    struct ox_span previous;
    int has_previous = 0;
    ox_usize used = 0UL;
    if (
        parser->at >= parser->length ||
        parser->bytes[parser->at] != (ox_u8)'{' ||
        parser->depth >= OX_JSON_DEPTH_MAX
    ) {
        return 0;
    }
    parser->depth += 1U;
    parser->at += 1UL;
    if (
        parser->at < parser->length &&
        parser->bytes[parser->at] == (ox_u8)'}'
    ) {
        parser->at += 1UL;
        parser->depth -= 1U;
        *count = 0UL;
        return 1;
    }
    for (;;) {
        struct ox_span key;
        struct ox_span value;
        enum ox_json_kind kind;
        if (!ox_parse_string(parser, &key)) return 0;
        if (
            has_previous &&
            ox_span_compare(
                parser->bytes,
                previous.start,
                previous.end,
                key.start,
                key.end
            ) >= 0
        ) {
            return 0;
        }
        previous = key;
        has_previous = 1;
        if (
            parser->at >= parser->length ||
            parser->bytes[parser->at] != (ox_u8)':')
        {
            return 0;
        }
        parser->at += 1UL;
        if (!ox_parse_value(parser, &kind, &value)) return 0;
        if (fields != (struct ox_field *)0) {
            if (used >= capacity) return 0;
            fields[used].key = key;
            fields[used].value = value;
            fields[used].kind = kind;
        }
        used += 1UL;
        if (parser->at >= parser->length) return 0;
        if (parser->bytes[parser->at] == (ox_u8)'}') {
            parser->at += 1UL;
            parser->depth -= 1U;
            *count = used;
            return 1;
        }
        if (parser->bytes[parser->at] != (ox_u8)',') return 0;
        parser->at += 1UL;
    }
}

static int ox_parse_value(
    struct ox_parser *parser,
    enum ox_json_kind *kind,
    struct ox_span *span
) {
    ox_usize start = parser->at;
    struct ox_span ignored;
    ox_usize count;
    if (start >= parser->length) return 0;
    if (parser->bytes[start] == (ox_u8)'"') {
        *kind = OX_JSON_STRING;
        if (!ox_parse_string(parser, &ignored)) return 0;
    } else if (parser->bytes[start] == (ox_u8)'{') {
        *kind = OX_JSON_OBJECT;
        if (!ox_parse_object_fields(parser, (struct ox_field *)0, 0UL, &count)) {
            return 0;
        }
    } else if (parser->bytes[start] == (ox_u8)'[') {
        *kind = OX_JSON_ARRAY;
        if (!ox_parse_array(parser)) return 0;
    } else if (
        parser->bytes[start] == (ox_u8)'-' ||
        (parser->bytes[start] >= (ox_u8)'0' &&
         parser->bytes[start] <= (ox_u8)'9')
    ) {
        *kind = OX_JSON_NUMBER;
        if (!ox_parse_number(parser)) return 0;
    } else if (
        parser->length - start >= 4UL &&
        ox_bytes_equal(parser->bytes + start, (const ox_u8 *)"true", 4UL)
    ) {
        *kind = OX_JSON_LITERAL;
        parser->at += 4UL;
    } else if (
        parser->length - start >= 5UL &&
        ox_bytes_equal(parser->bytes + start, (const ox_u8 *)"false", 5UL)
    ) {
        *kind = OX_JSON_LITERAL;
        parser->at += 5UL;
    } else if (
        parser->length - start >= 4UL &&
        ox_bytes_equal(parser->bytes + start, (const ox_u8 *)"null", 4UL)
    ) {
        *kind = OX_JSON_LITERAL;
        parser->at += 4UL;
    } else {
        return 0;
    }
    span->start = start;
    span->end = parser->at;
    return 1;
}

static int ox_canonical_line_fields(
    const ox_u8 *bytes,
    ox_usize length,
    ox_usize maximum,
    struct ox_field fields[OX_FIELD_MAX],
    ox_usize *count
) {
    struct ox_parser parser;
    if (
        length < 3UL || length > maximum || bytes[length - 1UL] != (ox_u8)'\n'
    ) {
        return 0;
    }
    parser.bytes = bytes;
    parser.length = length - 1UL;
    parser.at = 0UL;
    parser.depth = 0U;
    if (!ox_parse_object_fields(&parser, fields, OX_FIELD_MAX, count)) return 0;
    return parser.at == parser.length && parser.depth == 0U;
}

static int ox_key_equals(
    const ox_u8 *bytes,
    const struct ox_field *field,
    const char *expected
) {
    ox_usize length = ox_length(expected);
    return field->key.end - field->key.start == length &&
           ox_bytes_equal(
               bytes + field->key.start,
               (const ox_u8 *)expected,
               length
           );
}

static int ox_fields_exact(
    const ox_u8 *bytes,
    const struct ox_field *fields,
    ox_usize count,
    const char *const *expected,
    ox_usize expected_count
) {
    ox_usize index;
    if (count != expected_count) return 0;
    for (index = 0UL; index < count; index += 1UL) {
        if (!ox_key_equals(bytes, &fields[index], expected[index])) return 0;
    }
    return 1;
}

static const struct ox_field *ox_find_field(
    const ox_u8 *bytes,
    const struct ox_field *fields,
    ox_usize count,
    const char *name
) {
    ox_usize index;
    for (index = 0UL; index < count; index += 1UL) {
        if (ox_key_equals(bytes, &fields[index], name)) return &fields[index];
    }
    return (const struct ox_field *)0;
}

static int ox_string_copy(
    const ox_u8 *bytes,
    const struct ox_field *field,
    char *output,
    ox_usize output_bytes
) {
    ox_usize content_length;
    ox_usize index;
    if (
        field == (const struct ox_field *)0 ||
        field->kind != OX_JSON_STRING ||
        field->value.end < field->value.start + 2UL ||
        bytes[field->value.start] != (ox_u8)'"' ||
        bytes[field->value.end - 1UL] != (ox_u8)'"'
    ) {
        return 0;
    }
    content_length = field->value.end - field->value.start - 2UL;
    if (content_length + 1UL > output_bytes) return 0;
    for (index = 0UL; index < content_length; index += 1UL) {
        ox_u8 value = bytes[field->value.start + 1UL + index];
        if (value == (ox_u8)'\\' || value >= 0x80U) return 0;
        output[index] = (char)value;
    }
    output[content_length] = '\0';
    return 1;
}

static int ox_string_equals(
    const ox_u8 *bytes,
    const struct ox_field *field,
    const char *expected
) {
    char local[128];
    ox_usize length = ox_length(expected);
    if (length + 1UL > sizeof(local)) return 0;
    return ox_string_copy(bytes, field, local, sizeof(local)) &&
           ox_length(local) == length &&
           ox_bytes_equal(
               (const ox_u8 *)local,
               (const ox_u8 *)expected,
               length
           );
}

static int ox_digest_copy(
    const ox_u8 *bytes,
    const struct ox_field *field,
    char output[65]
) {
    ox_usize index;
    if (!ox_string_copy(bytes, field, output, 65UL)) return 0;
    if (ox_length(output) != 64UL) return 0;
    for (index = 0UL; index < 64UL; index += 1UL) {
        if (!ox_hex_digit((ox_u8)output[index])) return 0;
    }
    return 1;
}

static int ox_u64_value(
    const ox_u8 *bytes,
    const struct ox_field *field,
    ox_u64 *value
) {
    ox_usize index;
    ox_u64 parsed = 0UL;
    if (
        field == (const struct ox_field *)0 ||
        field->kind != OX_JSON_NUMBER ||
        field->value.start == field->value.end
    ) {
        return 0;
    }
    if (
        field->value.end - field->value.start > 1UL &&
        bytes[field->value.start] == (ox_u8)'0'
    ) {
        return 0;
    }
    for (index = field->value.start; index < field->value.end; index += 1UL) {
        ox_u8 digit = bytes[index];
        ox_u64 next;
        if (digit < (ox_u8)'0' || digit > (ox_u8)'9') return 0;
        next = parsed * 10UL + (ox_u64)(digit - (ox_u8)'0');
        if (next < parsed) return 0;
        parsed = next;
    }
    *value = parsed;
    return 1;
}

struct ox_builder {
    ox_u8 *bytes;
    ox_usize capacity;
    ox_usize length;
    int valid;
};

static void ox_builder_add(
    struct ox_builder *builder,
    const ox_u8 *bytes,
    ox_usize length
) {
    ox_usize index;
    if (!builder->valid || length > builder->capacity - builder->length) {
        builder->valid = 0;
        return;
    }
    for (index = 0UL; index < length; index += 1UL) {
        builder->bytes[builder->length + index] = bytes[index];
    }
    builder->length += length;
}

static void ox_builder_text(struct ox_builder *builder, const char *text) {
    ox_builder_add(builder, (const ox_u8 *)text, ox_length(text));
}

static void ox_builder_quoted(struct ox_builder *builder, const char *text) {
    ox_builder_text(builder, "\"");
    ox_builder_text(builder, text);
    ox_builder_text(builder, "\"");
}

static void ox_builder_property(
    struct ox_builder *builder,
    const char *name,
    const char *value,
    int first
) {
    if (!first) ox_builder_text(builder, ",");
    ox_builder_quoted(builder, name);
    ox_builder_text(builder, ":");
    ox_builder_quoted(builder, value);
}

static int ox_text_equal(const char *left, const char *right) {
    ox_usize left_length = ox_length(left);
    ox_usize right_length = ox_length(right);
    return left_length == right_length &&
           ox_bytes_equal(
               (const ox_u8 *)left,
               (const ox_u8 *)right,
               left_length
           );
}

static ox_u8 ox_line_buffer[OX_CAPSULE_FRAME_MAX + 1UL];
static ox_u8 ox_capsule_raw[OX_CAPSULE_RAW_MAX];
static ox_u8 ox_status_buffer[OX_STATUS_MAX + 1UL];
static ox_u8 ox_scratch[OX_START_MAX];

static int ox_read_line(ox_usize maximum, ox_usize *length) {
    ox_usize used = 0UL;
    for (;;) {
        long result;
        ox_u8 value;
        if (used >= maximum) return 0;
        result = ox_read_fd(0, &value, 1UL);
        if (result == -OX_EINTR) continue;
        if (result < 0L) return -1;
        if (result != 1L) return 0;
        ox_line_buffer[used] = value;
        used += 1UL;
        if (value == (ox_u8)'\n') {
            *length = used;
            return 1;
        }
    }
}

static int ox_write_all(const ox_u8 *bytes, ox_usize length) {
    ox_usize written = 0UL;
    while (written < length) {
        long result = ox_write_fd(1, bytes + written, length - written);
        if (result == -OX_EINTR) continue;
        if (result <= 0L) return 0;
        written += (ox_usize)result;
    }
    return 1;
}

static int ox_failure_diagnostic_sink_safe(void) {
    struct ox_kernel_stat status[3];
    int descriptor;
    int other;
    for (descriptor = 0; descriptor <= 2; descriptor += 1) {
        long flags = ox_fcntl_fd(descriptor, OX_F_GETFL);
        long descriptor_flags = ox_fcntl_fd(descriptor, OX_F_GETFD);
        long expected_access = descriptor == 0 ? OX_O_RDONLY : OX_O_WRONLY;
        if (
            flags < 0L || descriptor_flags != 0L ||
            (flags & OX_O_PATH) != 0L ||
            (flags & OX_O_ACCMODE) != expected_access ||
            ox_fstat_fd(descriptor, &status[descriptor]) < 0L ||
            (status[descriptor].mode & OX_S_IFMT) != OX_S_IFIFO
        ) {
            return 0;
        }
    }
    for (descriptor = 0; descriptor <= 2; descriptor += 1) {
        for (other = descriptor + 1; other <= 2; other += 1) {
            if (
                status[descriptor].device == status[other].device &&
                status[descriptor].inode == status[other].inode
            ) {
                return 0;
            }
        }
    }
    return 1;
}

static void ox_fail(int status) {
    ox_usize written = 0UL;
    if (ox_failure_diagnostic_sink_safe()) {
        while (written < sizeof(ox_failure_diagnostic)) {
            long result = ox_write_fd(
                2,
                ox_failure_diagnostic + written,
                sizeof(ox_failure_diagnostic) - written
            );
            if (result == -OX_EINTR) continue;
            if (result <= 0L) break;
            written += (ox_usize)result;
        }
    }
    ox_exit(status);
}

struct ox_start_context {
    char start_raw_sha256[65];
    char generation_identity_sha256[65];
    char request_sha256[65];
    char owner_request_sha256[65];
    char admission_generation_sha256[65];
    char birth_guardian_epoch_sha256[65];
    char actor_guardian_epoch_sha256[65];
    char launch_nonce_sha256[65];
    char control_generation_sha256[65];
    char job_generation_sha256[65];
    char supervisor_launch_intent_raw_sha256[65];
    char intended_supervisor_identity_sha256[65];
    char launch_capsule_raw_sha256[65];
    char launch_capsule_projection_sha256[65];
    char launch_requirements_sha256[65];
    char file_descriptor_map_sha256[65];
    char remap_plan_sha256[65];
    char preflight_requirements_sha256[65];
    ox_u64 launch_capsule_bytes;
};

struct ox_identity_context {
    char admission_generation_sha256[65];
    char birth_guardian_epoch_sha256[65];
    char boot_id_sha256[65];
    char bootstrap_requirements_sha256[65];
    char control_cgroup_name[80];
    char control_generation_sha256[65];
    char delegated_root_identity_sha256[65];
    char guardian_cgroup_name[80];
    char identity_sha256[65];
    char job_cgroup_name[80];
    char job_generation_sha256[65];
    char launch_capsule_projection_sha256[65];
    char launch_capsule_raw_sha256[65];
    char launch_nonce_sha256[65];
    char launch_requirements_sha256[65];
    char limits_sha256[65];
    char owner_request_sha256[65];
    char request_sha256[65];
    char supervisor_executable_identity_sha256[65];
};

struct ox_capsule_context {
    char capsule_frame_raw_sha256[65];
};

struct ox_cancel_context {
    char cancel_raw_sha256[65];
    char decision_projection_sha256[65];
    char decision_journal_record_raw_sha256[65];
    char reason[32];
};

static const char *const ox_start_fields[] = {
    "action",
    "actorGuardianEpochSha256",
    "admissionGenerationSha256",
    "birthGuardianEpochSha256",
    "commandSequence",
    "controlGenerationSha256",
    "fileDescriptorMapSha256",
    "generationIdentity",
    "generationIdentitySha256",
    "intendedSupervisorExecutableIdentitySha256",
    "jobGenerationSha256",
    "launchCapsuleByteLength",
    "launchCapsuleProjectionSha256",
    "launchCapsuleRawSha256",
    "launchNonceSha256",
    "launchRequirementsSha256",
    "ownerRequestSha256",
    "preflightRequirementsSha256",
    "remapPlanSha256",
    "requestSha256",
    "schema",
    "supervisorLaunchIntentRecordRawSha256"
};

static const char *const ox_identity_fields[] = {
    "admissionGenerationSha256",
    "birthGuardianEpochSha256",
    "bootIdSha256",
    "bootstrapRequirementsSha256",
    "controlCgroupName",
    "controlGenerationSha256",
    "delegatedRootIdentitySha256",
    "guardianCgroupName",
    "identitySha256",
    "jobCgroupName",
    "jobGenerationSha256",
    "launchCapsuleProjectionSha256",
    "launchCapsuleRawSha256",
    "launchNonceSha256",
    "launchRequirementsSha256",
    "limitsSha256",
    "ownerRequestSha256",
    "requestSha256",
    "schema",
    "supervisorExecutableIdentitySha256"
};

static const char *const ox_capsule_frame_fields[] = {
    "action",
    "actorGuardianEpochSha256",
    "admissionGenerationSha256",
    "birthGuardianEpochSha256",
    "commandSequence",
    "fileDescriptorMapSha256",
    "generationIdentitySha256",
    "intendedSupervisorExecutableIdentitySha256",
    "launchCapsuleBase64",
    "launchCapsuleByteLength",
    "launchCapsuleProjectionSha256",
    "launchCapsuleRawSha256",
    "launchNonceSha256",
    "launchRequirementsSha256",
    "ownerRequestSha256",
    "preflightRequirementsSha256",
    "remapPlanSha256",
    "requestSha256",
    "schema",
    "startRawSha256",
    "supervisorLaunchIntentRecordRawSha256"
};

static const char *const ox_launch_capsule_fields[] = {
    "argv",
    "environment",
    "fileDescriptorMapSha256",
    "files",
    "generationSha256",
    "remapPlanSha256",
    "requestSha256",
    "requirementsSha256",
    "resultMaximumBytes",
    "schema"
};

static const char *const ox_cancel_fields[] = {
    "action",
    "actorGuardianEpochSha256",
    "admissionGenerationSha256",
    "birthGuardianEpochSha256",
    "cancelDecision",
    "cancelDecisionProjectionSha256",
    "capsuleFrameRawSha256",
    "commandSequence",
    "decisionJournalRecordRawSha256",
    "generationIdentitySha256",
    "launchNonceSha256",
    "ownerRequestSha256",
    "preflightReadyRawSha256",
    "preflightRequirementsSha256",
    "reason",
    "requestSha256",
    "schema",
    "startRawSha256"
};

static const char *const ox_cancel_decision_fields[] = {
    "action",
    "actorGuardianEpochSha256",
    "admissionGenerationSha256",
    "birthGuardianEpochSha256",
    "capsuleFrameRawSha256",
    "generationIdentitySha256",
    "launchNonceSha256",
    "ownerRequestSha256",
    "preflightReadyRawSha256",
    "preflightRequirementsSha256",
    "projectionSha256",
    "reason",
    "requestSha256",
    "schema",
    "startRawSha256"
};

static int ox_nested_fields(
    const ox_u8 *bytes,
    const struct ox_field *field,
    struct ox_field output[OX_FIELD_MAX],
    ox_usize *count
) {
    struct ox_parser parser;
    if (
        field == (const struct ox_field *)0 ||
        field->kind != OX_JSON_OBJECT
    ) {
        return 0;
    }
    parser.bytes = bytes;
    parser.length = field->value.end;
    parser.at = field->value.start;
    parser.depth = 0U;
    if (!ox_parse_object_fields(&parser, output, OX_FIELD_MAX, count)) return 0;
    return parser.at == field->value.end && parser.depth == 0U;
}

static int ox_digest_field(
    const ox_u8 *bytes,
    const struct ox_field *fields,
    ox_usize count,
    const char *name,
    char output[65]
) {
    return ox_digest_copy(bytes, ox_find_field(bytes, fields, count, name), output);
}

static int ox_string_field(
    const ox_u8 *bytes,
    const struct ox_field *fields,
    ox_usize count,
    const char *name,
    char *output,
    ox_usize output_bytes
) {
    return ox_string_copy(
        bytes,
        ox_find_field(bytes, fields, count, name),
        output,
        output_bytes
    );
}

static int ox_expected_digest_field(
    const ox_u8 *bytes,
    const struct ox_field *fields,
    ox_usize count,
    const char *name,
    const char *expected
) {
    char digest[65];
    return ox_digest_field(bytes, fields, count, name, digest) &&
           ox_text_equal(digest, expected);
}

static int ox_derive_generation(
    const char *role,
    const struct ox_identity_context *identity,
    char output[65]
) {
    struct ox_builder builder;
    builder.bytes = ox_scratch;
    builder.capacity = sizeof(ox_scratch);
    builder.length = 0UL;
    builder.valid = 1;
    ox_builder_text(&builder, "{");
    ox_builder_property(
        &builder,
        "admissionGenerationSha256",
        identity->admission_generation_sha256,
        1
    );
    ox_builder_property(
        &builder,
        "birthGuardianEpochSha256",
        identity->birth_guardian_epoch_sha256,
        0
    );
    ox_builder_property(&builder, "role", role, 0);
    ox_builder_property(
        &builder,
        "schema",
        "oxigraph.candidate-containment-guardian-generation-derivation/v1",
        0
    );
    ox_builder_text(&builder, "}");
    if (!builder.valid) return 0;
    ox_sha256_hex(builder.bytes, builder.length, output);
    return 1;
}

static int ox_prefixed_digest_equal(
    const char *actual,
    const char *prefix,
    const char *digest
) {
    ox_usize prefix_length = ox_length(prefix);
    return ox_length(actual) == prefix_length + 64UL &&
           ox_bytes_equal(
               (const ox_u8 *)actual,
               (const ox_u8 *)prefix,
               prefix_length
           ) &&
           ox_bytes_equal(
               (const ox_u8 *)actual + prefix_length,
               (const ox_u8 *)digest,
               64UL
           );
}

static int ox_identity_hash(
    const struct ox_identity_context *identity,
    char output[65]
) {
    struct ox_builder builder;
    builder.bytes = ox_scratch;
    builder.capacity = sizeof(ox_scratch);
    builder.length = 0UL;
    builder.valid = 1;
    ox_builder_text(&builder, "{");
    ox_builder_property(
        &builder,
        "admissionGenerationSha256",
        identity->admission_generation_sha256,
        1
    );
    ox_builder_property(
        &builder,
        "birthGuardianEpochSha256",
        identity->birth_guardian_epoch_sha256,
        0
    );
    ox_builder_property(&builder, "bootIdSha256", identity->boot_id_sha256, 0);
    ox_builder_property(
        &builder,
        "bootstrapRequirementsSha256",
        identity->bootstrap_requirements_sha256,
        0
    );
    ox_builder_property(
        &builder,
        "controlCgroupName",
        identity->control_cgroup_name,
        0
    );
    ox_builder_property(
        &builder,
        "controlGenerationSha256",
        identity->control_generation_sha256,
        0
    );
    ox_builder_property(
        &builder,
        "delegatedRootIdentitySha256",
        identity->delegated_root_identity_sha256,
        0
    );
    ox_builder_property(
        &builder,
        "guardianCgroupName",
        identity->guardian_cgroup_name,
        0
    );
    ox_builder_property(&builder, "jobCgroupName", identity->job_cgroup_name, 0);
    ox_builder_property(
        &builder,
        "jobGenerationSha256",
        identity->job_generation_sha256,
        0
    );
    ox_builder_property(
        &builder,
        "launchCapsuleProjectionSha256",
        identity->launch_capsule_projection_sha256,
        0
    );
    ox_builder_property(
        &builder,
        "launchCapsuleRawSha256",
        identity->launch_capsule_raw_sha256,
        0
    );
    ox_builder_property(
        &builder,
        "launchNonceSha256",
        identity->launch_nonce_sha256,
        0
    );
    ox_builder_property(
        &builder,
        "launchRequirementsSha256",
        identity->launch_requirements_sha256,
        0
    );
    ox_builder_property(&builder, "limitsSha256", identity->limits_sha256, 0);
    ox_builder_property(
        &builder,
        "ownerRequestSha256",
        identity->owner_request_sha256,
        0
    );
    ox_builder_property(&builder, "requestSha256", identity->request_sha256, 0);
    ox_builder_property(
        &builder,
        "schema",
        "oxigraph.candidate-containment-guardian-generation-identity/v1",
        0
    );
    ox_builder_property(
        &builder,
        "supervisorExecutableIdentitySha256",
        identity->supervisor_executable_identity_sha256,
        0
    );
    ox_builder_text(&builder, "}");
    if (!builder.valid) return 0;
    ox_sha256_hex(builder.bytes, builder.length, output);
    return 1;
}

static int ox_parse_identity(
    const ox_u8 *bytes,
    const struct ox_field *identity_field,
    struct ox_identity_context *identity
) {
    struct ox_field fields[OX_FIELD_MAX];
    ox_usize count;
    char expected_control[65];
    char expected_job[65];
    char expected_identity[65];
    if (
        !ox_nested_fields(bytes, identity_field, fields, &count) ||
        !ox_fields_exact(
            bytes,
            fields,
            count,
            ox_identity_fields,
            sizeof(ox_identity_fields) / sizeof(ox_identity_fields[0])
        ) ||
        !ox_string_equals(
            bytes,
            ox_find_field(bytes, fields, count, "schema"),
            "oxigraph.candidate-containment-guardian-generation-identity/v1"
        ) ||
        !ox_digest_field(
            bytes, fields, count, "admissionGenerationSha256",
            identity->admission_generation_sha256
        ) ||
        !ox_digest_field(
            bytes, fields, count, "birthGuardianEpochSha256",
            identity->birth_guardian_epoch_sha256
        ) ||
        !ox_digest_field(bytes, fields, count, "bootIdSha256", identity->boot_id_sha256) ||
        !ox_digest_field(
            bytes, fields, count, "bootstrapRequirementsSha256",
            identity->bootstrap_requirements_sha256
        ) ||
        !ox_string_field(
            bytes, fields, count, "controlCgroupName",
            identity->control_cgroup_name, sizeof(identity->control_cgroup_name)
        ) ||
        !ox_digest_field(
            bytes, fields, count, "controlGenerationSha256",
            identity->control_generation_sha256
        ) ||
        !ox_digest_field(
            bytes, fields, count, "delegatedRootIdentitySha256",
            identity->delegated_root_identity_sha256
        ) ||
        !ox_string_field(
            bytes, fields, count, "guardianCgroupName",
            identity->guardian_cgroup_name, sizeof(identity->guardian_cgroup_name)
        ) ||
        !ox_digest_field(bytes, fields, count, "identitySha256", identity->identity_sha256) ||
        !ox_string_field(
            bytes, fields, count, "jobCgroupName",
            identity->job_cgroup_name, sizeof(identity->job_cgroup_name)
        ) ||
        !ox_digest_field(
            bytes, fields, count, "jobGenerationSha256",
            identity->job_generation_sha256
        ) ||
        !ox_digest_field(
            bytes, fields, count, "launchCapsuleProjectionSha256",
            identity->launch_capsule_projection_sha256
        ) ||
        !ox_digest_field(
            bytes, fields, count, "launchCapsuleRawSha256",
            identity->launch_capsule_raw_sha256
        ) ||
        !ox_digest_field(
            bytes, fields, count, "launchNonceSha256",
            identity->launch_nonce_sha256
        ) ||
        !ox_digest_field(
            bytes, fields, count, "launchRequirementsSha256",
            identity->launch_requirements_sha256
        ) ||
        !ox_digest_field(bytes, fields, count, "limitsSha256", identity->limits_sha256) ||
        !ox_digest_field(
            bytes, fields, count, "ownerRequestSha256",
            identity->owner_request_sha256
        ) ||
        !ox_digest_field(bytes, fields, count, "requestSha256", identity->request_sha256) ||
        !ox_digest_field(
            bytes, fields, count, "supervisorExecutableIdentitySha256",
            identity->supervisor_executable_identity_sha256
        ) ||
        !ox_derive_generation("control", identity, expected_control) ||
        !ox_derive_generation("job", identity, expected_job) ||
        !ox_text_equal(identity->control_generation_sha256, expected_control) ||
        !ox_text_equal(identity->job_generation_sha256, expected_job) ||
        !ox_prefixed_digest_equal(
            identity->guardian_cgroup_name,
            "guardian-",
            identity->birth_guardian_epoch_sha256
        ) ||
        !ox_prefixed_digest_equal(
            identity->control_cgroup_name,
            "ctl-",
            identity->control_generation_sha256
        ) ||
        !ox_prefixed_digest_equal(
            identity->job_cgroup_name,
            "job-",
            identity->job_generation_sha256
        ) ||
        !ox_identity_hash(identity, expected_identity) ||
        !ox_text_equal(identity->identity_sha256, expected_identity)
    ) {
        return 0;
    }
    return 1;
}

static int ox_parse_start(
    const ox_u8 *bytes,
    ox_usize length,
    struct ox_start_context *start
) {
    struct ox_field fields[OX_FIELD_MAX];
    struct ox_identity_context identity;
    ox_usize count;
    ox_u64 sequence;
    ox_u64 capsule_bytes;
    if (
        !ox_canonical_line_fields(bytes, length, OX_START_MAX, fields, &count) ||
        !ox_fields_exact(
            bytes,
            fields,
            count,
            ox_start_fields,
            sizeof(ox_start_fields) / sizeof(ox_start_fields[0])
        ) ||
        !ox_string_equals(
            bytes,
            ox_find_field(bytes, fields, count, "schema"),
            "oxigraph.candidate-containment-supervisor-preflight-start/v1"
        ) ||
        !ox_string_equals(
            bytes,
            ox_find_field(bytes, fields, count, "action"),
            "START"
        ) ||
        !ox_u64_value(
            bytes,
            ox_find_field(bytes, fields, count, "commandSequence"),
            &sequence
        ) ||
        sequence != 0UL ||
        !ox_u64_value(
            bytes,
            ox_find_field(bytes, fields, count, "launchCapsuleByteLength"),
            &capsule_bytes
        ) ||
        capsule_bytes < 2UL || capsule_bytes > OX_CAPSULE_RAW_MAX ||
        !ox_parse_identity(
            bytes,
            ox_find_field(bytes, fields, count, "generationIdentity"),
            &identity
        ) ||
        !ox_digest_field(
            bytes, fields, count, "generationIdentitySha256",
            start->generation_identity_sha256
        ) ||
        !ox_digest_field(bytes, fields, count, "requestSha256", start->request_sha256) ||
        !ox_digest_field(
            bytes, fields, count, "ownerRequestSha256",
            start->owner_request_sha256
        ) ||
        !ox_digest_field(
            bytes, fields, count, "admissionGenerationSha256",
            start->admission_generation_sha256
        ) ||
        !ox_digest_field(
            bytes, fields, count, "birthGuardianEpochSha256",
            start->birth_guardian_epoch_sha256
        ) ||
        !ox_digest_field(
            bytes, fields, count, "actorGuardianEpochSha256",
            start->actor_guardian_epoch_sha256
        ) ||
        !ox_digest_field(
            bytes, fields, count, "launchNonceSha256",
            start->launch_nonce_sha256
        ) ||
        !ox_digest_field(
            bytes, fields, count, "controlGenerationSha256",
            start->control_generation_sha256
        ) ||
        !ox_digest_field(
            bytes, fields, count, "jobGenerationSha256",
            start->job_generation_sha256
        ) ||
        !ox_digest_field(
            bytes, fields, count, "supervisorLaunchIntentRecordRawSha256",
            start->supervisor_launch_intent_raw_sha256
        ) ||
        !ox_digest_field(
            bytes, fields, count, "intendedSupervisorExecutableIdentitySha256",
            start->intended_supervisor_identity_sha256
        ) ||
        !ox_digest_field(
            bytes, fields, count, "launchCapsuleRawSha256",
            start->launch_capsule_raw_sha256
        ) ||
        !ox_digest_field(
            bytes, fields, count, "launchCapsuleProjectionSha256",
            start->launch_capsule_projection_sha256
        ) ||
        !ox_digest_field(
            bytes, fields, count, "launchRequirementsSha256",
            start->launch_requirements_sha256
        ) ||
        !ox_digest_field(
            bytes, fields, count, "fileDescriptorMapSha256",
            start->file_descriptor_map_sha256
        ) ||
        !ox_digest_field(
            bytes, fields, count, "remapPlanSha256",
            start->remap_plan_sha256
        ) ||
        !ox_digest_field(
            bytes, fields, count, "preflightRequirementsSha256",
            start->preflight_requirements_sha256
        ) ||
        !ox_text_equal(start->generation_identity_sha256, identity.identity_sha256) ||
        !ox_text_equal(start->request_sha256, identity.request_sha256) ||
        !ox_text_equal(start->owner_request_sha256, identity.owner_request_sha256) ||
        !ox_text_equal(
            start->admission_generation_sha256,
            identity.admission_generation_sha256
        ) ||
        !ox_text_equal(
            start->birth_guardian_epoch_sha256,
            identity.birth_guardian_epoch_sha256
        ) ||
        !ox_text_equal(
            start->actor_guardian_epoch_sha256,
            start->birth_guardian_epoch_sha256
        ) ||
        !ox_text_equal(start->launch_nonce_sha256, identity.launch_nonce_sha256) ||
        !ox_text_equal(
            start->control_generation_sha256,
            identity.control_generation_sha256
        ) ||
        !ox_text_equal(start->job_generation_sha256, identity.job_generation_sha256) ||
        !ox_text_equal(
            start->intended_supervisor_identity_sha256,
            identity.supervisor_executable_identity_sha256
        ) ||
        !ox_text_equal(
            start->launch_capsule_raw_sha256,
            identity.launch_capsule_raw_sha256
        ) ||
        !ox_text_equal(
            start->launch_capsule_projection_sha256,
            identity.launch_capsule_projection_sha256
        ) ||
        !ox_text_equal(
            start->launch_requirements_sha256,
            identity.launch_requirements_sha256
        ) ||
        !ox_text_equal(start->launch_requirements_sha256, ox_launch_requirements_sha256) ||
        !ox_text_equal(start->file_descriptor_map_sha256, ox_fd_map_sha256) ||
        !ox_text_equal(start->remap_plan_sha256, ox_remap_plan_sha256) ||
        !ox_text_equal(
            start->preflight_requirements_sha256,
            ox_preflight_requirements_sha256
        )
    ) {
        return 0;
    }
    start->launch_capsule_bytes = capsule_bytes;
    ox_sha256_hex(bytes, length, start->start_raw_sha256);
    return 1;
}

static int ox_base64_value(ox_u8 value) {
    if (value >= (ox_u8)'A' && value <= (ox_u8)'Z') {
        return (int)(value - (ox_u8)'A');
    }
    if (value >= (ox_u8)'a' && value <= (ox_u8)'z') {
        return (int)(value - (ox_u8)'a') + 26;
    }
    if (value >= (ox_u8)'0' && value <= (ox_u8)'9') {
        return (int)(value - (ox_u8)'0') + 52;
    }
    if (value == (ox_u8)'+') return 62;
    if (value == (ox_u8)'/') return 63;
    return -1;
}

static int ox_decode_base64(
    const ox_u8 *bytes,
    const struct ox_field *field,
    ox_usize *decoded_length
) {
    ox_usize start;
    ox_usize length;
    ox_usize input;
    ox_usize output = 0UL;
    if (
        field == (const struct ox_field *)0 ||
        field->kind != OX_JSON_STRING ||
        field->value.end < field->value.start + 6UL ||
        bytes[field->value.start] != (ox_u8)'"' ||
        bytes[field->value.end - 1UL] != (ox_u8)'"'
    ) {
        return 0;
    }
    start = field->value.start + 1UL;
    length = field->value.end - field->value.start - 2UL;
    if (length == 0UL || (length & 3UL) != 0UL) return 0;
    for (input = 0UL; input < length; input += 4UL) {
        int first = ox_base64_value(bytes[start + input]);
        int second = ox_base64_value(bytes[start + input + 1UL]);
        int third = ox_base64_value(bytes[start + input + 2UL]);
        int fourth = ox_base64_value(bytes[start + input + 3UL]);
        int final_group = input + 4UL == length;
        if (first < 0 || second < 0 || output >= OX_CAPSULE_RAW_MAX) return 0;
        ox_capsule_raw[output] = (ox_u8)((first << 2) | (second >> 4));
        output += 1UL;
        if (bytes[start + input + 2UL] == (ox_u8)'=') {
            if (
                !final_group || bytes[start + input + 3UL] != (ox_u8)'=' ||
                (second & 15) != 0
            ) {
                return 0;
            }
            continue;
        }
        if (third < 0 || output >= OX_CAPSULE_RAW_MAX) return 0;
        ox_capsule_raw[output] =
            (ox_u8)(((second & 15) << 4) | (third >> 2));
        output += 1UL;
        if (bytes[start + input + 3UL] == (ox_u8)'=') {
            if (!final_group || (third & 3) != 0) return 0;
            continue;
        }
        if (fourth < 0 || output >= OX_CAPSULE_RAW_MAX) return 0;
        ox_capsule_raw[output] =
            (ox_u8)(((third & 3) << 6) | fourth);
        output += 1UL;
    }
    *decoded_length = output;
    return 1;
}

static int ox_parse_launch_capsule_headers(
    const ox_u8 *bytes,
    ox_usize length,
    const struct ox_start_context *start
) {
    struct ox_field fields[OX_FIELD_MAX];
    ox_usize count;
    return ox_canonical_line_fields(
               bytes,
               length,
               OX_CAPSULE_RAW_MAX,
               fields,
               &count
           ) &&
           ox_fields_exact(
               bytes,
               fields,
               count,
               ox_launch_capsule_fields,
               sizeof(ox_launch_capsule_fields) /
                   sizeof(ox_launch_capsule_fields[0])
           ) &&
           ox_string_equals(
               bytes,
               ox_find_field(bytes, fields, count, "schema"),
               "oxigraph.candidate-containment-launch-capsule/v2"
           ) &&
           ox_expected_digest_field(
               bytes, fields, count, "requestSha256", start->request_sha256
           ) &&
           ox_expected_digest_field(
               bytes,
               fields,
               count,
               "generationSha256",
               start->admission_generation_sha256
           ) &&
           ox_expected_digest_field(
               bytes,
               fields,
               count,
               "requirementsSha256",
               start->launch_requirements_sha256
           ) &&
           ox_expected_digest_field(
               bytes,
               fields,
               count,
               "fileDescriptorMapSha256",
               start->file_descriptor_map_sha256
           ) &&
           ox_expected_digest_field(
               bytes,
               fields,
               count,
               "remapPlanSha256",
               start->remap_plan_sha256
           );
}

static int ox_parse_capsule_frame(
    const ox_u8 *bytes,
    ox_usize length,
    const struct ox_start_context *start,
    struct ox_capsule_context *capsule
) {
    struct ox_field fields[OX_FIELD_MAX];
    ox_usize count;
    ox_u64 sequence;
    ox_u64 declared_length;
    ox_usize decoded_length;
    char decoded_sha256[65];
    if (
        !ox_canonical_line_fields(
            bytes,
            length,
            OX_CAPSULE_FRAME_MAX,
            fields,
            &count
        ) ||
        !ox_fields_exact(
            bytes,
            fields,
            count,
            ox_capsule_frame_fields,
            sizeof(ox_capsule_frame_fields) /
                sizeof(ox_capsule_frame_fields[0])
        ) ||
        !ox_string_equals(
            bytes,
            ox_find_field(bytes, fields, count, "schema"),
            "oxigraph.candidate-containment-supervisor-preflight-capsule/v1"
        ) ||
        !ox_string_equals(
            bytes,
            ox_find_field(bytes, fields, count, "action"),
            "CAPSULE"
        ) ||
        !ox_u64_value(
            bytes,
            ox_find_field(bytes, fields, count, "commandSequence"),
            &sequence
        ) ||
        sequence != 1UL ||
        !ox_u64_value(
            bytes,
            ox_find_field(bytes, fields, count, "launchCapsuleByteLength"),
            &declared_length
        ) ||
        declared_length != start->launch_capsule_bytes ||
        !ox_expected_digest_field(
            bytes, fields, count, "startRawSha256", start->start_raw_sha256
        ) ||
        !ox_expected_digest_field(
            bytes,
            fields,
            count,
            "generationIdentitySha256",
            start->generation_identity_sha256
        ) ||
        !ox_expected_digest_field(
            bytes, fields, count, "requestSha256", start->request_sha256
        ) ||
        !ox_expected_digest_field(
            bytes,
            fields,
            count,
            "ownerRequestSha256",
            start->owner_request_sha256
        ) ||
        !ox_expected_digest_field(
            bytes,
            fields,
            count,
            "admissionGenerationSha256",
            start->admission_generation_sha256
        ) ||
        !ox_expected_digest_field(
            bytes,
            fields,
            count,
            "birthGuardianEpochSha256",
            start->birth_guardian_epoch_sha256
        ) ||
        !ox_expected_digest_field(
            bytes,
            fields,
            count,
            "actorGuardianEpochSha256",
            start->actor_guardian_epoch_sha256
        ) ||
        !ox_expected_digest_field(
            bytes,
            fields,
            count,
            "launchNonceSha256",
            start->launch_nonce_sha256
        ) ||
        !ox_expected_digest_field(
            bytes,
            fields,
            count,
            "supervisorLaunchIntentRecordRawSha256",
            start->supervisor_launch_intent_raw_sha256
        ) ||
        !ox_expected_digest_field(
            bytes,
            fields,
            count,
            "intendedSupervisorExecutableIdentitySha256",
            start->intended_supervisor_identity_sha256
        ) ||
        !ox_expected_digest_field(
            bytes,
            fields,
            count,
            "launchCapsuleRawSha256",
            start->launch_capsule_raw_sha256
        ) ||
        !ox_expected_digest_field(
            bytes,
            fields,
            count,
            "launchCapsuleProjectionSha256",
            start->launch_capsule_projection_sha256
        ) ||
        !ox_expected_digest_field(
            bytes,
            fields,
            count,
            "launchRequirementsSha256",
            start->launch_requirements_sha256
        ) ||
        !ox_expected_digest_field(
            bytes,
            fields,
            count,
            "fileDescriptorMapSha256",
            start->file_descriptor_map_sha256
        ) ||
        !ox_expected_digest_field(
            bytes,
            fields,
            count,
            "remapPlanSha256",
            start->remap_plan_sha256
        ) ||
        !ox_expected_digest_field(
            bytes,
            fields,
            count,
            "preflightRequirementsSha256",
            start->preflight_requirements_sha256
        ) ||
        !ox_decode_base64(
            bytes,
            ox_find_field(bytes, fields, count, "launchCapsuleBase64"),
            &decoded_length
        ) ||
        decoded_length != declared_length
    ) {
        return 0;
    }
    ox_sha256_hex(ox_capsule_raw, decoded_length, decoded_sha256);
    if (
        !ox_text_equal(decoded_sha256, start->launch_capsule_raw_sha256) ||
        !ox_parse_launch_capsule_headers(ox_capsule_raw, decoded_length, start)
    ) {
        return 0;
    }
    ox_sha256_hex(bytes, length, capsule->capsule_frame_raw_sha256);
    return 1;
}

static int ox_descriptor_preflight(void) {
    struct ox_kernel_stat status[18];
    int descriptor;
    int other;
    for (descriptor = 0; descriptor <= 17; descriptor += 1) {
        long flags = ox_fcntl_fd(descriptor, OX_F_GETFL);
        long descriptor_flags = ox_fcntl_fd(descriptor, OX_F_GETFD);
        ox_u32 expected_kind;
        long expected_access;
        if (
            flags < 0L || descriptor_flags != 0L ||
            (flags & OX_O_PATH) != 0L ||
            ox_fstat_fd(descriptor, &status[descriptor]) < 0L
        ) {
            return 0;
        }
        if (descriptor == 0) {
            expected_access = OX_O_RDONLY;
            expected_kind = OX_S_IFIFO;
        } else if (descriptor == 1 || descriptor == 2) {
            expected_access = OX_O_WRONLY;
            expected_kind = OX_S_IFIFO;
        } else if (descriptor == 3) {
            expected_access = OX_O_RDONLY;
            expected_kind = OX_S_IFDIR;
        } else if (descriptor <= 16) {
            expected_access = OX_O_RDONLY;
            expected_kind = OX_S_IFREG;
        } else {
            expected_access = OX_O_RDWR;
            expected_kind = OX_S_IFREG;
        }
        if (
            (flags & OX_O_ACCMODE) != expected_access ||
            (status[descriptor].mode & OX_S_IFMT) != expected_kind
        ) {
            return 0;
        }
    }
    for (descriptor = 0; descriptor <= 17; descriptor += 1) {
        for (other = descriptor + 1; other <= 17; other += 1) {
            if (
                status[descriptor].device == status[other].device &&
                status[descriptor].inode == status[other].inode
            ) {
                return 0;
            }
        }
    }
    return ox_close_unexpected_descriptors() == 0L;
}

static const char ox_authority_json[] =
    "{\"applicationReceiptAuthority\":false,"
    "\"applicationResultAuthority\":false,"
    "\"containmentExecutionAuthority\":false,"
    "\"descriptorAuthority\":false,"
    "\"filesystemDurabilityAuthority\":false,"
    "\"finalDecisionAuthority\":false,"
    "\"guardianAuthority\":false,"
    "\"nativeObservationAuthority\":false,"
    "\"productionContainment\":false,"
    "\"promotionAuthority\":false,"
    "\"publicationAuthority\":false,"
    "\"qualificationAuthority\":false,"
    "\"reapAuthority\":false,"
    "\"runtimeRegistrationAuthority\":false,"
    "\"sandboxReportAuthority\":false,"
    "\"supervisorAuthority\":false}";

static const char ox_nonclaims_json[] =
    "{\"historicalBootstrapRequirementAuthorizesV3Ready\":false,"
    "\"historicalBootstrapRequirementReinterpretsV3Ready\":false,"
    "\"serializedReplayProvesCapsuleProjectionValidation\":false,"
    "\"serializedReplayProvesCgroupConfiguration\":false,"
    "\"serializedReplayProvesCgroupFilesystem\":false,"
    "\"serializedReplayProvesCleanup\":false,"
    "\"serializedReplayProvesDecisionDurability\":false,"
    "\"serializedReplayProvesDelegatedRootIdentity\":false,"
    "\"serializedReplayProvesDirectChildReap\":false,"
    "\"serializedReplayProvesExecutedSupervisorFdBinding\":false,"
    "\"serializedReplayProvesFrameOrigin\":false,"
    "\"serializedReplayProvesFreshness\":false,"
    "\"serializedReplayProvesGlobalSoleWriterOwnership\":false,"
    "\"serializedReplayProvesGuardianLauncherWriterClosure\":false,"
    "\"serializedReplayProvesInheritedDescriptorExactness\":false,"
    "\"serializedReplayProvesNativeSupervisorExecution\":false,"
    "\"serializedReplayProvesPhysicalContainment\":false,"
    "\"serializedReplayProvesRetainedFileContentIdentity\":false,"
    "\"serializedReplayProvesSemanticCapsuleValidation\":false,"
    "\"suppliedObservationProvesNativeOrigin\":false}";

static const char ox_physical_facts_json[] =
    "{\"binding\":null,"
    "\"cgroupConfiguration\":null,"
    "\"cgroupEmptiness\":null,"
    "\"cgroupFilesystem\":null,"
    "\"cgroupLimits\":null,"
    "\"childCreated\":null,"
    "\"cleanupOutcome\":null,"
    "\"cleanupSafe\":null,"
    "\"decisionDurability\":null,"
    "\"delegatedRootIdentity\":null,"
    "\"directChildPidfdWaitidReap\":null,"
    "\"executedSupervisorBoundToFd6\":null,"
    "\"finalDecisionEligibility\":false,"
    "\"guardianLauncherStatusWriterCopiesClosed\":null,"
    "\"launchCapsuleProjectionValidation\":null,"
    "\"physicalEligibility\":false,"
    "\"productionContainment\":false,"
    "\"retainedFileContentIdentity\":null,"
    "\"semanticLaunchCapsuleValidation\":null,"
    "\"supervisorExecuted\":null,"
    "\"supervisorExitStatus\":null,"
    "\"supervisorReaped\":null}";

static const char ox_ready_evidence_json[] =
    "{\"binding\":null,"
    "\"canonicalBase64Accepted\":true,"
    "\"canonicalCapsuleEnvelopeAccepted\":true,"
    "\"canonicalStartAccepted\":true,"
    "\"cgroupConfiguration\":null,"
    "\"cgroupEmptiness\":null,"
    "\"cgroupFilesystem\":null,"
    "\"cgroupLimits\":null,"
    "\"cleanupOutcome\":null,"
    "\"cleanupSafe\":null,"
    "\"decisionDurability\":null,"
    "\"decodedCapsuleByteLengthMatched\":true,"
    "\"decodedCapsuleRawSha256Matched\":true,"
    "\"delegatedRootIdentity\":null,"
    "\"descriptorAccessModesMatched\":true,"
    "\"descriptorKindsMatched\":true,"
    "\"descriptorNonaliasInSupervisorTable\":true,"
    "\"descriptorsEighteenAndAboveClosedBeforeReady\":true,"
    "\"descriptorsZeroThroughSeventeenStructurallyChecked\":true,"
    "\"directChildPidfdWaitidReap\":null,"
    "\"executedSupervisorBoundToFd6\":null,"
    "\"finalDecisionEligibility\":false,"
    "\"guardianLauncherStatusWriterCopiesClosed\":null,"
    "\"launchCapsuleHeaderBindingsMatched\":true,"
    "\"launchCapsuleProjectionValidation\":null,"
    "\"physicalEligibility\":false,"
    "\"retainedFileContentIdentity\":null,"
    "\"semanticLaunchCapsuleValidation\":null,"
    "\"statusWriterUniqueInSupervisorTable\":true}";

static const char ox_cancelled_evidence_json[] =
    "{\"childCreated\":false,"
    "\"cloneCommitStarted\":false,"
    "\"decisionDurability\":null,"
    "\"guardianCleanupObservedBySupervisor\":null,"
    "\"guardianCleanupRequired\":true,"
    "\"pidfdCreated\":false,"
    "\"retainedDescriptorsClosed\":true}";

static const char ox_done_evidence_json[] =
    "{\"childCreated\":false,"
    "\"guardianCleanupObservedBySupervisor\":null,"
    "\"statusFrameIsFinal\":true,"
    "\"statusWriteClosureObservedBySupervisor\":null}";

static void ox_builder_raw_property(
    struct ox_builder *builder,
    const char *name,
    const char *raw_value,
    int first
) {
    if (!first) ox_builder_text(builder, ",");
    ox_builder_quoted(builder, name);
    ox_builder_text(builder, ":");
    ox_builder_text(builder, raw_value);
}

static int ox_build_status(
    const struct ox_start_context *start,
    const struct ox_capsule_context *capsule,
    const struct ox_cancel_context *cancel,
    const char *state,
    int sequence,
    const char *previous_status_raw_sha256,
    const char *evidence_json,
    ox_usize *length
) {
    struct ox_builder builder;
    int terminal = cancel != (const struct ox_cancel_context *)0;
    builder.bytes = ox_status_buffer;
    builder.capacity = OX_STATUS_MAX;
    builder.length = 0UL;
    builder.valid = 1;
    ox_builder_text(&builder, "{");
    ox_builder_property(
        &builder,
        "actorGuardianEpochSha256",
        start->actor_guardian_epoch_sha256,
        1
    );
    ox_builder_property(
        &builder,
        "admissionGenerationSha256",
        start->admission_generation_sha256,
        0
    );
    ox_builder_raw_property(&builder, "authority", ox_authority_json, 0);
    ox_builder_property(
        &builder,
        "birthGuardianEpochSha256",
        start->birth_guardian_epoch_sha256,
        0
    );
    ox_builder_property(
        &builder,
        "capsuleFrameRawSha256",
        capsule->capsule_frame_raw_sha256,
        0
    );
    if (terminal) {
        ox_builder_property(
            &builder,
            "decisionJournalRecordRawSha256",
            cancel->decision_journal_record_raw_sha256,
            0
        );
        ox_builder_property(
            &builder,
            "decisionRawSha256",
            cancel->cancel_raw_sha256,
            0
        );
    } else {
        ox_builder_raw_property(&builder, "decisionRawSha256", "null", 0);
    }
    ox_builder_raw_property(&builder, "evidence", evidence_json, 0);
    ox_builder_property(
        &builder,
        "generationIdentitySha256",
        start->generation_identity_sha256,
        0
    );
    ox_builder_property(
        &builder,
        "intendedSupervisorExecutableIdentitySha256",
        start->intended_supervisor_identity_sha256,
        0
    );
    ox_builder_property(
        &builder,
        "launchNonceSha256",
        start->launch_nonce_sha256,
        0
    );
    ox_builder_raw_property(&builder, "nonclaims", ox_nonclaims_json, 0);
    ox_builder_property(
        &builder,
        "ownerRequestSha256",
        start->owner_request_sha256,
        0
    );
    ox_builder_raw_property(
        &builder,
        "physicalFacts",
        ox_physical_facts_json,
        0
    );
    ox_builder_property(
        &builder,
        "preflightRequirementsSha256",
        start->preflight_requirements_sha256,
        0
    );
    if (terminal) {
        ox_builder_property(
            &builder,
            "previousStatusRawSha256",
            previous_status_raw_sha256,
            0
        );
    }
    ox_builder_property(&builder, "requestSha256", start->request_sha256, 0);
    ox_builder_property(
        &builder,
        "schema",
        "oxigraph.candidate-containment-supervisor-preflight-status/v1",
        0
    );
    ox_builder_property(&builder, "startRawSha256", start->start_raw_sha256, 0);
    ox_builder_property(&builder, "state", state, 0);
    ox_builder_raw_property(
        &builder,
        "statusSequence",
        sequence == 0 ? "0" : (sequence == 1 ? "1" : "2"),
        0
    );
    ox_builder_text(&builder, "}\n");
    if (!builder.valid || builder.length > OX_STATUS_MAX) return 0;
    *length = builder.length;
    return 1;
}

static int ox_reason_allowed(const char *reason) {
    return ox_text_equal(reason, "caller-abort") ||
           ox_text_equal(reason, "decision-timeout") ||
           ox_text_equal(reason, "guardian-shutdown");
}

static int ox_build_cancel_decision_hash(
    const struct ox_start_context *start,
    const struct ox_capsule_context *capsule,
    const char *ready_raw_sha256,
    const char *reason,
    char output[65]
) {
    struct ox_builder builder;
    builder.bytes = ox_scratch;
    builder.capacity = sizeof(ox_scratch);
    builder.length = 0UL;
    builder.valid = 1;
    ox_builder_text(&builder, "{");
    ox_builder_property(&builder, "action", "CANCEL", 1);
    ox_builder_property(
        &builder,
        "actorGuardianEpochSha256",
        start->actor_guardian_epoch_sha256,
        0
    );
    ox_builder_property(
        &builder,
        "admissionGenerationSha256",
        start->admission_generation_sha256,
        0
    );
    ox_builder_property(
        &builder,
        "birthGuardianEpochSha256",
        start->birth_guardian_epoch_sha256,
        0
    );
    ox_builder_property(
        &builder,
        "capsuleFrameRawSha256",
        capsule->capsule_frame_raw_sha256,
        0
    );
    ox_builder_property(
        &builder,
        "generationIdentitySha256",
        start->generation_identity_sha256,
        0
    );
    ox_builder_property(
        &builder,
        "launchNonceSha256",
        start->launch_nonce_sha256,
        0
    );
    ox_builder_property(
        &builder,
        "ownerRequestSha256",
        start->owner_request_sha256,
        0
    );
    ox_builder_property(
        &builder,
        "preflightReadyRawSha256",
        ready_raw_sha256,
        0
    );
    ox_builder_property(
        &builder,
        "preflightRequirementsSha256",
        start->preflight_requirements_sha256,
        0
    );
    ox_builder_property(&builder, "reason", reason, 0);
    ox_builder_property(&builder, "requestSha256", start->request_sha256, 0);
    ox_builder_property(
        &builder,
        "schema",
        "oxigraph.candidate-containment-supervisor-preflight-cancel-decision/v1",
        0
    );
    ox_builder_property(&builder, "startRawSha256", start->start_raw_sha256, 0);
    ox_builder_text(&builder, "}");
    if (!builder.valid) return 0;
    ox_sha256_hex(builder.bytes, builder.length, output);
    return 1;
}

static int ox_parse_cancel_decision(
    const ox_u8 *bytes,
    const struct ox_field *decision_field,
    const struct ox_start_context *start,
    const struct ox_capsule_context *capsule,
    const char *ready_raw_sha256,
    struct ox_cancel_context *cancel
) {
    struct ox_field fields[OX_FIELD_MAX];
    ox_usize count;
    char projected[65];
    if (
        !ox_nested_fields(bytes, decision_field, fields, &count) ||
        !ox_fields_exact(
            bytes,
            fields,
            count,
            ox_cancel_decision_fields,
            sizeof(ox_cancel_decision_fields) /
                sizeof(ox_cancel_decision_fields[0])
        ) ||
        !ox_string_equals(
            bytes,
            ox_find_field(bytes, fields, count, "schema"),
            "oxigraph.candidate-containment-supervisor-preflight-cancel-decision/v1"
        ) ||
        !ox_string_equals(
            bytes,
            ox_find_field(bytes, fields, count, "action"),
            "CANCEL"
        ) ||
        !ox_string_field(
            bytes, fields, count, "reason", cancel->reason, sizeof(cancel->reason)
        ) ||
        !ox_reason_allowed(cancel->reason) ||
        !ox_expected_digest_field(
            bytes, fields, count, "startRawSha256", start->start_raw_sha256
        ) ||
        !ox_expected_digest_field(
            bytes,
            fields,
            count,
            "capsuleFrameRawSha256",
            capsule->capsule_frame_raw_sha256
        ) ||
        !ox_expected_digest_field(
            bytes,
            fields,
            count,
            "preflightReadyRawSha256",
            ready_raw_sha256
        ) ||
        !ox_expected_digest_field(
            bytes,
            fields,
            count,
            "generationIdentitySha256",
            start->generation_identity_sha256
        ) ||
        !ox_expected_digest_field(
            bytes, fields, count, "requestSha256", start->request_sha256
        ) ||
        !ox_expected_digest_field(
            bytes,
            fields,
            count,
            "ownerRequestSha256",
            start->owner_request_sha256
        ) ||
        !ox_expected_digest_field(
            bytes,
            fields,
            count,
            "admissionGenerationSha256",
            start->admission_generation_sha256
        ) ||
        !ox_expected_digest_field(
            bytes,
            fields,
            count,
            "birthGuardianEpochSha256",
            start->birth_guardian_epoch_sha256
        ) ||
        !ox_expected_digest_field(
            bytes,
            fields,
            count,
            "actorGuardianEpochSha256",
            start->actor_guardian_epoch_sha256
        ) ||
        !ox_expected_digest_field(
            bytes,
            fields,
            count,
            "launchNonceSha256",
            start->launch_nonce_sha256
        ) ||
        !ox_expected_digest_field(
            bytes,
            fields,
            count,
            "preflightRequirementsSha256",
            start->preflight_requirements_sha256
        ) ||
        !ox_digest_field(
            bytes,
            fields,
            count,
            "projectionSha256",
            cancel->decision_projection_sha256
        ) ||
        !ox_build_cancel_decision_hash(
            start,
            capsule,
            ready_raw_sha256,
            cancel->reason,
            projected
        ) ||
        !ox_text_equal(cancel->decision_projection_sha256, projected)
    ) {
        return 0;
    }
    return 1;
}

static int ox_parse_cancel(
    const ox_u8 *bytes,
    ox_usize length,
    const struct ox_start_context *start,
    const struct ox_capsule_context *capsule,
    const char *ready_raw_sha256,
    struct ox_cancel_context *cancel
) {
    struct ox_field fields[OX_FIELD_MAX];
    ox_usize count;
    ox_u64 sequence;
    char top_reason[32];
    char top_projection[65];
    if (
        !ox_canonical_line_fields(bytes, length, OX_CONTROL_MAX, fields, &count) ||
        !ox_fields_exact(
            bytes,
            fields,
            count,
            ox_cancel_fields,
            sizeof(ox_cancel_fields) / sizeof(ox_cancel_fields[0])
        ) ||
        !ox_string_equals(
            bytes,
            ox_find_field(bytes, fields, count, "schema"),
            "oxigraph.candidate-containment-supervisor-preflight-control/v1"
        ) ||
        !ox_string_equals(
            bytes,
            ox_find_field(bytes, fields, count, "action"),
            "CANCEL"
        ) ||
        !ox_u64_value(
            bytes,
            ox_find_field(bytes, fields, count, "commandSequence"),
            &sequence
        ) ||
        sequence != 2UL ||
        !ox_parse_cancel_decision(
            bytes,
            ox_find_field(bytes, fields, count, "cancelDecision"),
            start,
            capsule,
            ready_raw_sha256,
            cancel
        ) ||
        !ox_string_field(
            bytes, fields, count, "reason", top_reason, sizeof(top_reason)
        ) ||
        !ox_text_equal(top_reason, cancel->reason) ||
        !ox_digest_field(
            bytes,
            fields,
            count,
            "cancelDecisionProjectionSha256",
            top_projection
        ) ||
        !ox_text_equal(top_projection, cancel->decision_projection_sha256) ||
        !ox_digest_field(
            bytes,
            fields,
            count,
            "decisionJournalRecordRawSha256",
            cancel->decision_journal_record_raw_sha256
        ) ||
        !ox_expected_digest_field(
            bytes, fields, count, "startRawSha256", start->start_raw_sha256
        ) ||
        !ox_expected_digest_field(
            bytes,
            fields,
            count,
            "capsuleFrameRawSha256",
            capsule->capsule_frame_raw_sha256
        ) ||
        !ox_expected_digest_field(
            bytes,
            fields,
            count,
            "preflightReadyRawSha256",
            ready_raw_sha256
        ) ||
        !ox_expected_digest_field(
            bytes,
            fields,
            count,
            "generationIdentitySha256",
            start->generation_identity_sha256
        ) ||
        !ox_expected_digest_field(
            bytes, fields, count, "requestSha256", start->request_sha256
        ) ||
        !ox_expected_digest_field(
            bytes,
            fields,
            count,
            "ownerRequestSha256",
            start->owner_request_sha256
        ) ||
        !ox_expected_digest_field(
            bytes,
            fields,
            count,
            "admissionGenerationSha256",
            start->admission_generation_sha256
        ) ||
        !ox_expected_digest_field(
            bytes,
            fields,
            count,
            "birthGuardianEpochSha256",
            start->birth_guardian_epoch_sha256
        ) ||
        !ox_expected_digest_field(
            bytes,
            fields,
            count,
            "actorGuardianEpochSha256",
            start->actor_guardian_epoch_sha256
        ) ||
        !ox_expected_digest_field(
            bytes,
            fields,
            count,
            "launchNonceSha256",
            start->launch_nonce_sha256
        ) ||
        !ox_expected_digest_field(
            bytes,
            fields,
            count,
            "preflightRequirementsSha256",
            start->preflight_requirements_sha256
        )
    ) {
        return 0;
    }
    ox_sha256_hex(bytes, length, cancel->cancel_raw_sha256);
    return 1;
}

static int ox_close_retained_descriptors(void) {
    int descriptor;
    if (ox_close_fd(0) != 0L) return 0;
    for (descriptor = 3; descriptor <= 17; descriptor += 1) {
        if (ox_close_fd(descriptor) != 0L) return 0;
    }
    return 1;
}

static int ox_require_command_eof(void) {
    ox_u8 byte;
    for (;;) {
        long result = ox_read_fd(0, &byte, 1UL);
        if (result == -OX_EINTR) continue;
        if (result == 0L) return 1;
        if (result < 0L) return -1;
        return 0;
    }
}

/*
 * The kernel enters an ELF entry point without the return-address stack slot a
 * C function ABI assumes. Align explicitly, then CALL so the private C main
 * observes the ordinary SysV x86-64 entry alignment. The unreachable UD2 is a
 * final fail-closed guard if the noreturn contract is ever violated.
 */
__asm__(
    ".global oxigraph_supervisor_preflight_entry\n"
    ".type oxigraph_supervisor_preflight_entry,@function\n"
    "oxigraph_supervisor_preflight_entry:\n"
    "andq $-16,%rsp\n"
    "call oxigraph_supervisor_preflight_main\n"
    "ud2\n"
    ".size oxigraph_supervisor_preflight_entry,"
    ".-oxigraph_supervisor_preflight_entry\n"
);

__attribute__((noreturn, used, noinline, visibility("hidden")))
void oxigraph_supervisor_preflight_main(void) {
    struct ox_start_context start;
    struct ox_capsule_context capsule;
    struct ox_cancel_context cancel;
    ox_usize line_length;
    ox_usize status_length;
    char ready_raw_sha256[65];
    char cancelled_raw_sha256[65];
    int read_result;
    int eof_result;

    if (ox_ignore_sigpipe() != 0L) ox_exit(126);

    read_result = ox_read_line(OX_START_MAX, &line_length);
    if (read_result < 0) ox_fail(126);
    if (
        read_result == 0 ||
        !ox_parse_start(ox_line_buffer, line_length, &start)
    ) {
        ox_fail(125);
    }

    read_result = ox_read_line(OX_CAPSULE_FRAME_MAX, &line_length);
    if (read_result < 0) ox_fail(126);
    if (
        read_result == 0 ||
        !ox_parse_capsule_frame(
            ox_line_buffer,
            line_length,
            &start,
            &capsule
        )
    ) {
        ox_fail(125);
    }

    if (!ox_descriptor_preflight()) ox_fail(126);
    if (
        !ox_build_status(
            &start,
            &capsule,
            (const struct ox_cancel_context *)0,
            "PREFLIGHT_READY",
            0,
            (const char *)0,
            ox_ready_evidence_json,
            &status_length
        )
    ) {
        ox_fail(126);
    }
    ox_sha256_hex(ox_status_buffer, status_length, ready_raw_sha256);
    if (!ox_write_all(ox_status_buffer, status_length)) ox_fail(126);

    read_result = ox_read_line(OX_CONTROL_MAX, &line_length);
    if (read_result < 0) ox_fail(126);
    if (
        read_result == 0 ||
        !ox_parse_cancel(
            ox_line_buffer,
            line_length,
            &start,
            &capsule,
            ready_raw_sha256,
            &cancel
        )
    ) {
        ox_fail(125);
    }
    eof_result = ox_require_command_eof();
    if (eof_result < 0) ox_fail(126);
    if (eof_result == 0) ox_fail(125);
    if (!ox_close_retained_descriptors()) ox_fail(126);

    if (
        !ox_build_status(
            &start,
            &capsule,
            &cancel,
            "CANCELLED_WITHOUT_CLONE",
            1,
            ready_raw_sha256,
            ox_cancelled_evidence_json,
            &status_length
        )
    ) {
        ox_fail(126);
    }
    ox_sha256_hex(ox_status_buffer, status_length, cancelled_raw_sha256);
    if (!ox_write_all(ox_status_buffer, status_length)) ox_fail(126);

    if (
        !ox_build_status(
            &start,
            &capsule,
            &cancel,
            "SUPERVISOR_DONE",
            2,
            cancelled_raw_sha256,
            ox_done_evidence_json,
            &status_length
        )
    ) {
        ox_fail(126);
    }
    if (!ox_write_all(ox_status_buffer, status_length)) ox_fail(126);
    if (ox_close_fd(1) != 0L) ox_fail(126);
    ox_exit(124);
}
