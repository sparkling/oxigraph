#define _GNU_SOURCE

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <linux/openat2.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <unistd.h>

#define MAX_PATH_BYTES 4096U
#define MAX_NAME_BYTES 255U
#define MAX_EXCLUDES 64U
#define MAX_FILE_BYTES (512ULL * 1024ULL * 1024ULL)
#define COPY_BUFFER_BYTES (1024U * 1024U)

struct counters {
    uint64_t bytes;
    uint64_t directories;
    uint64_t files;
    uint64_t symlinks;
    uint64_t entries;
    uint64_t max_file_bytes;
    uint64_t max_bytes;
    uint64_t max_entries;
};

struct exclusions {
    const char *values[MAX_EXCLUDES];
    size_t length;
};

static void die(const char *reason) {
    fprintf(stderr, "g17-snapshot-helper: %s\n", reason);
    exit(70);
}

static void die_errno(const char *reason) {
    fprintf(stderr, "g17-snapshot-helper: %s: %s\n", reason, strerror(errno));
    exit(70);
}

static void die_path_errno(const char *reason, const char *relative) {
    fprintf(
        stderr,
        "g17-snapshot-helper: %s (%s): %s\n",
        reason,
        relative,
        strerror(errno)
    );
    exit(70);
}

static bool same_stat(const struct stat *left, const struct stat *right) {
    return left->st_dev == right->st_dev &&
           left->st_ino == right->st_ino &&
           left->st_mode == right->st_mode &&
           left->st_nlink == right->st_nlink &&
           left->st_size == right->st_size &&
           left->st_mtim.tv_sec == right->st_mtim.tv_sec &&
           left->st_mtim.tv_nsec == right->st_mtim.tv_nsec &&
           left->st_ctim.tv_sec == right->st_ctim.tv_sec &&
           left->st_ctim.tv_nsec == right->st_ctim.tv_nsec;
}

static bool same_object(const struct stat *left, const struct stat *right) {
    return left->st_dev == right->st_dev &&
           left->st_ino == right->st_ino &&
           (left->st_mode & S_IFMT) == (right->st_mode & S_IFMT);
}

static int open_beneath(int directory, const char *path, int flags, mode_t mode) {
    struct open_how how = {
        .flags = (uint64_t)flags,
        .mode = (uint64_t)mode,
        .resolve = RESOLVE_BENEATH | RESOLVE_NO_MAGICLINKS | RESOLVE_NO_SYMLINKS,
    };
    return (int)syscall(SYS_openat2, directory, path, &how, sizeof(how));
}

static int open_delete_beneath(
    int directory,
    const char *path,
    int flags,
    mode_t mode
) {
    struct open_how how = {
        .flags = (uint64_t)flags,
        .mode = (uint64_t)mode,
        .resolve = RESOLVE_BENEATH |
                   RESOLVE_NO_MAGICLINKS |
                   RESOLVE_NO_SYMLINKS |
                   RESOLVE_NO_XDEV,
    };
    return (int)syscall(SYS_openat2, directory, path, &how, sizeof(how));
}

static bool safe_relative_path(const char *path) {
    size_t length = strlen(path);
    if (length < 1U || length >= MAX_PATH_BYTES || path[0] == '/' ||
        path[length - 1U] == '/' || strstr(path, "//") != NULL ||
        strstr(path, "/./") != NULL || strstr(path, "/../") != NULL ||
        strcmp(path, ".") == 0 || strcmp(path, "..") == 0) {
        return false;
    }
    return true;
}

static uint64_t parse_positive_u64(const char *value, const char *label) {
    if (value == NULL || value[0] == '\0' || value[0] == '-' || value[0] == '+') {
        die(label);
    }
    errno = 0;
    char *end = NULL;
    unsigned long long parsed = strtoull(value, &end, 10);
    if (errno != 0 || end == value || *end != '\0' || parsed == 0ULL) {
        die(label);
    }
    return (uint64_t)parsed;
}

static bool excluded(const struct exclusions *exclusions, const char *relative) {
    for (size_t index = 0U; index < exclusions->length; index += 1U) {
        const char *value = exclusions->values[index];
        size_t length = strlen(value);
        if (strcmp(relative, value) == 0 ||
            (strncmp(relative, value, length) == 0 && relative[length] == '/')) {
            return true;
        }
    }
    return false;
}

static int compare_names(const void *left, const void *right) {
    const char *const *left_name = left;
    const char *const *right_name = right;
    return strcmp(*left_name, *right_name);
}

static char **directory_names(
    int descriptor,
    size_t *count,
    uint64_t maximum_entries
) {
    int duplicate = dup(descriptor);
    if (duplicate < 0) die_errno("cannot duplicate source directory");
    DIR *directory = fdopendir(duplicate);
    if (directory == NULL) {
        close(duplicate);
        die_errno("cannot enumerate source directory");
    }
    char **names = NULL;
    size_t length = 0U;
    size_t capacity = 0U;
    errno = 0;
    for (;;) {
        struct dirent *entry = readdir(directory);
        if (entry == NULL) break;
        if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0) {
            continue;
        }
        size_t name_length = strlen(entry->d_name);
        if (name_length < 1U || name_length > MAX_NAME_BYTES ||
            strchr(entry->d_name, '/') != NULL) {
            closedir(directory);
            die("source directory contains an unsafe entry name");
        }
        if ((uint64_t)length >= maximum_entries) {
            closedir(directory);
            die("directory inventory exceeds the entry ceiling");
        }
        if (length == capacity) {
            size_t next = capacity == 0U ? 64U : capacity * 2U;
            char **grown = realloc(names, next * sizeof(*names));
            if (grown == NULL) {
                closedir(directory);
                die("cannot allocate directory inventory");
            }
            names = grown;
            capacity = next;
        }
        names[length] = strdup(entry->d_name);
        if (names[length] == NULL) {
            closedir(directory);
            die("cannot allocate directory entry");
        }
        length += 1U;
    }
    if (errno != 0) {
        closedir(directory);
        die_errno("source directory enumeration failed");
    }
    if (closedir(directory) != 0) die_errno("cannot close source directory");
    qsort(names, length, sizeof(*names), compare_names);
    *count = length;
    return names;
}

static void release_names(char **names, size_t count) {
    for (size_t index = 0U; index < count; index += 1U) free(names[index]);
    free(names);
}

static char *child_relative(const char *parent, const char *name) {
    size_t parent_length = strlen(parent);
    size_t name_length = strlen(name);
    size_t needed = parent_length == 0U
        ? name_length + 1U
        : parent_length + 1U + name_length + 1U;
    if (needed > MAX_PATH_BYTES) die("source relative path is unbounded");
    char *value = malloc(needed);
    if (value == NULL) die("cannot allocate source relative path");
    if (parent_length == 0U) {
        memcpy(value, name, name_length + 1U);
    } else {
        snprintf(value, needed, "%s/%s", parent, name);
    }
    return value;
}

static void count_entry(struct counters *counters) {
    if (counters->entries >= counters->max_entries) {
        die("entry ceiling exceeded");
    }
    counters->entries += 1U;
}

static void copy_entry(
    int source_parent,
    const char *source_name,
    int destination_parent,
    const char *destination_name,
    const char *relative,
    const struct exclusions *exclusions,
    struct counters *counters
);

static void copy_directory(
    int source_parent,
    const char *source_name,
    int destination_parent,
    const char *destination_name,
    const char *relative,
    const struct exclusions *exclusions,
    struct counters *counters,
    const struct stat *initial
) {
    int source = open_beneath(
        source_parent,
        source_name,
        O_RDONLY | O_DIRECTORY | O_CLOEXEC,
        0
    );
    if (source < 0) die_errno("cannot open source directory through openat2");
    struct stat opened;
    if (fstat(source, &opened) != 0 || !same_stat(initial, &opened)) {
        close(source);
        die("source directory identity changed before traversal");
    }
    if (mkdirat(destination_parent, destination_name, 0700) != 0) {
        close(source);
        die_errno("cannot create destination directory exclusively");
    }
    int destination = open_beneath(
        destination_parent,
        destination_name,
        O_RDONLY | O_DIRECTORY | O_CLOEXEC,
        0
    );
    if (destination < 0) {
        close(source);
        die_errno("cannot open destination directory through openat2");
    }
    size_t name_count = 0U;
    char **names = directory_names(source, &name_count, counters->max_entries);
    for (size_t index = 0U; index < name_count; index += 1U) {
        char *child = child_relative(relative, names[index]);
        copy_entry(
            source,
            names[index],
            destination,
            names[index],
            child,
            exclusions,
            counters
        );
        free(child);
    }
    release_names(names, name_count);
    struct stat after;
    if (fstat(source, &after) != 0 || !same_stat(initial, &after)) {
        close(source);
        close(destination);
        die("source directory changed during traversal");
    }
    if (fchmod(destination, 0555) != 0 || fsync(destination) != 0) {
        close(source);
        close(destination);
        die_errno("cannot freeze destination directory");
    }
    if (close(source) != 0 || close(destination) != 0) {
        die_errno("cannot close copied directory");
    }
    counters->directories += 1U;
}

static void copy_regular_file(
    int source_parent,
    const char *source_name,
    int destination_parent,
    const char *destination_name,
    struct counters *counters,
    const struct stat *initial
) {
    if (initial->st_nlink != 1) {
        die("source regular file has multiple hard links");
    }
    if (initial->st_size < 0 || counters->bytes > counters->max_bytes ||
        (uint64_t)initial->st_size > MAX_FILE_BYTES ||
        (uint64_t)initial->st_size > counters->max_file_bytes ||
        (uint64_t)initial->st_size > counters->max_bytes - counters->bytes) {
        die("source file exceeds its byte ceiling");
    }
    int source = open_beneath(source_parent, source_name, O_RDONLY | O_CLOEXEC, 0);
    if (source < 0) die_errno("cannot open source file through openat2");
    struct stat opened;
    if (fstat(source, &opened) != 0 || !same_stat(initial, &opened)) {
        close(source);
        die("source file identity changed before copy");
    }
    int destination = openat(
        destination_parent,
        destination_name,
        O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,
        0600
    );
    if (destination < 0) {
        close(source);
        die_errno("cannot create destination file exclusively");
    }
    unsigned char *buffer = malloc(COPY_BUFFER_BYTES);
    if (buffer == NULL) {
        close(source);
        close(destination);
        die("cannot allocate copy buffer");
    }
    uint64_t copied = 0U;
    for (;;) {
        ssize_t observed = read(source, buffer, COPY_BUFFER_BYTES);
        if (observed < 0) {
            free(buffer);
            close(source);
            close(destination);
            die_errno("source file read failed");
        }
        if (observed == 0) break;
        uint64_t chunk = (uint64_t)observed;
        if (copied > counters->max_file_bytes ||
            chunk > counters->max_file_bytes - copied ||
            counters->bytes > counters->max_bytes ||
            copied > counters->max_bytes - counters->bytes ||
            chunk > counters->max_bytes - counters->bytes - copied) {
            free(buffer);
            close(source);
            close(destination);
            die("source file grew beyond its byte ceiling");
        }
        ssize_t offset = 0;
        while (offset < observed) {
            ssize_t written = write(destination, buffer + offset, (size_t)(observed - offset));
            if (written <= 0) {
                free(buffer);
                close(source);
                close(destination);
                die_errno("destination file write failed");
            }
            offset += written;
        }
        copied += (uint64_t)observed;
    }
    free(buffer);
    struct stat after;
    if (fstat(source, &after) != 0 || !same_stat(initial, &after) ||
        copied != (uint64_t)initial->st_size) {
        close(source);
        close(destination);
        die("source file changed during copy");
    }
    mode_t mode = (initial->st_mode & 0111) == 0 ? 0444 : 0555;
    if (fchmod(destination, mode) != 0 || fsync(destination) != 0) {
        close(source);
        close(destination);
        die_errno("cannot freeze destination file");
    }
    if (close(source) != 0 || close(destination) != 0) {
        die_errno("cannot close copied file");
    }
    counters->bytes += copied;
    counters->files += 1U;
}

static void copy_symbolic_link(
    int source_parent,
    const char *source_name,
    int destination_parent,
    const char *destination_name,
    const struct stat *initial,
    struct counters *counters
) {
    char target[MAX_PATH_BYTES];
    ssize_t length = readlinkat(source_parent, source_name, target, sizeof(target));
    if (length < 1 || (size_t)length >= sizeof(target)) {
        die("source symlink target is absent or unbounded");
    }
    target[length] = '\0';
    if (counters->bytes > counters->max_bytes ||
        (uint64_t)length > counters->max_bytes - counters->bytes) {
        die("source symlink exceeds the aggregate byte ceiling");
    }
    struct stat after;
    if (fstatat(source_parent, source_name, &after, AT_SYMLINK_NOFOLLOW) != 0 ||
        !same_stat(initial, &after)) {
        die("source symlink changed during copy");
    }
    if (symlinkat(target, destination_parent, destination_name) != 0) {
        die_errno("cannot create destination symlink exclusively");
    }
    counters->bytes += (uint64_t)length;
}

static void copy_entry(
    int source_parent,
    const char *source_name,
    int destination_parent,
    const char *destination_name,
    const char *relative,
    const struct exclusions *exclusions,
    struct counters *counters
) {
    if (excluded(exclusions, relative)) return;
    count_entry(counters);
    struct stat initial;
    if (fstatat(source_parent, source_name, &initial, AT_SYMLINK_NOFOLLOW) != 0) {
        die_path_errno("cannot inspect source entry without following links", relative);
    }
    if (S_ISDIR(initial.st_mode)) {
        copy_directory(
            source_parent,
            source_name,
            destination_parent,
            destination_name,
            relative,
            exclusions,
            counters,
            &initial
        );
        return;
    }
    if (S_ISREG(initial.st_mode)) {
        copy_regular_file(
            source_parent,
            source_name,
            destination_parent,
            destination_name,
            counters,
            &initial
        );
        return;
    }
    if (S_ISLNK(initial.st_mode)) {
        copy_symbolic_link(
            source_parent,
            source_name,
            destination_parent,
            destination_name,
            &initial,
            counters
        );
        counters->symlinks += 1U;
        return;
    }
    die("source entry type is unsupported");
}

static void delete_entry(
    int parent,
    const char *name,
    uint64_t depth,
    dev_t root_device,
    struct counters *counters,
    uint64_t maximum_depth
);

static void delete_directory_contents(
    int directory,
    uint64_t depth,
    dev_t root_device,
    struct counters *counters,
    uint64_t maximum_depth
) {
    if (depth > maximum_depth) die("delete depth ceiling exceeded");
    if (fchmod(directory, 0700) != 0) {
        die_errno("cannot make pinned delete directory removable");
    }
    int fresh = openat(
        directory,
        ".",
        O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
    );
    if (fresh < 0) die_errno("cannot reopen pinned delete directory");
    struct stat original;
    struct stat reopened;
    if (fstat(directory, &original) != 0 || fstat(fresh, &reopened) != 0 ||
        !S_ISDIR(reopened.st_mode) || !same_object(&original, &reopened) ||
        reopened.st_dev != root_device) {
        close(fresh);
        die("pinned delete directory identity changed");
    }
    size_t name_count = 0U;
    char **names = directory_names(fresh, &name_count, counters->max_entries);
    for (size_t index = 0U; index < name_count; index += 1U) {
        delete_entry(
            fresh,
            names[index],
            depth + 1U,
            root_device,
            counters,
            maximum_depth
        );
    }
    release_names(names, name_count);
    if (close(fresh) != 0) die_errno("cannot close traversed delete directory");
}

static void delete_entry(
    int parent,
    const char *name,
    uint64_t depth,
    dev_t root_device,
    struct counters *counters,
    uint64_t maximum_depth
) {
    if (depth > maximum_depth) die("delete depth ceiling exceeded");
    count_entry(counters);
    struct stat initial;
    if (fstatat(parent, name, &initial, AT_SYMLINK_NOFOLLOW) != 0) {
        die_errno("cannot inspect delete entry without following links");
    }
    if (initial.st_dev != root_device) {
        die("delete entry crosses the pinned root device");
    }
    if (S_ISDIR(initial.st_mode)) {
        int child = open_delete_beneath(
            parent,
            name,
            O_RDONLY | O_DIRECTORY | O_CLOEXEC,
            0
        );
        if (child < 0) die_errno("cannot open delete directory through openat2");
        struct stat opened;
        if (fstat(child, &opened) != 0 || !same_object(&initial, &opened)) {
            close(child);
            die("delete directory identity changed before traversal");
        }
        delete_directory_contents(
            child,
            depth,
            root_device,
            counters,
            maximum_depth
        );
        struct stat current;
        struct stat held;
        if (fstatat(parent, name, &current, AT_SYMLINK_NOFOLLOW) != 0 ||
            fstat(child, &held) != 0 ||
            !same_object(&initial, &current) ||
            !same_object(&initial, &held)) {
            close(child);
            die("delete directory identity changed before removal");
        }
        if (close(child) != 0) die_errno("cannot close delete directory");
        if (unlinkat(parent, name, AT_REMOVEDIR) != 0) {
            die_errno("cannot remove pinned delete directory");
        }
        counters->directories += 1U;
        return;
    }
    if (!S_ISREG(initial.st_mode) && !S_ISLNK(initial.st_mode)) {
        die("delete entry type is unsupported");
    }
    struct stat current;
    if (fstatat(parent, name, &current, AT_SYMLINK_NOFOLLOW) != 0 ||
        !same_object(&initial, &current)) {
        die("delete entry identity changed before removal");
    }
    if (unlinkat(parent, name, 0) != 0) {
        die_errno("cannot unlink pinned delete entry");
    }
    if (S_ISREG(initial.st_mode)) {
        counters->files += 1U;
    } else {
        counters->symlinks += 1U;
    }
}

static void delete_root(
    int parent,
    int root,
    const char *target_name,
    struct counters *counters,
    uint64_t maximum_depth
) {
    struct stat held;
    struct stat named;
    if (fstat(parent, &named) != 0 || !S_ISDIR(named.st_mode) ||
        fstat(root, &held) != 0 || !S_ISDIR(held.st_mode) ||
        fstatat(parent, target_name, &named, AT_SYMLINK_NOFOLLOW) != 0 ||
        !S_ISDIR(named.st_mode) || !same_object(&held, &named)) {
        die("pinned delete root and parent leaf do not match");
    }
    counters->entries = 1U;
    counters->directories = 1U;
    delete_directory_contents(
        root,
        0U,
        held.st_dev,
        counters,
        maximum_depth
    );
    struct stat held_after;
    struct stat named_after;
    if (fstat(root, &held_after) != 0 ||
        fstatat(parent, target_name, &named_after, AT_SYMLINK_NOFOLLOW) != 0 ||
        !same_object(&held, &held_after) ||
        !same_object(&held, &named_after)) {
        die("pinned delete root identity changed before final removal");
    }
    if (unlinkat(parent, target_name, AT_REMOVEDIR) != 0) {
        die_errno("cannot remove pinned delete root");
    }
    if (fstatat(parent, target_name, &named_after, AT_SYMLINK_NOFOLLOW) == 0 ||
        errno != ENOENT) {
        die("pinned delete root remains after removal");
    }
}

int main(int argc, char **argv) {
    const char *operation = NULL;
    const char *source_name = NULL;
    const char *destination_name = NULL;
    const char *target_name = NULL;
    uint64_t maximum_depth = 0U;
    struct exclusions exclusions = { .length = 0U };
    struct counters counters = {0};
    for (int index = 1; index < argc; index += 1) {
        if (strcmp(argv[index], "--operation") == 0 && index + 1 < argc) {
            operation = argv[++index];
        } else if (strcmp(argv[index], "--source-name") == 0 && index + 1 < argc) {
            source_name = argv[++index];
        } else if (strcmp(argv[index], "--destination-name") == 0 && index + 1 < argc) {
            destination_name = argv[++index];
        } else if (strcmp(argv[index], "--target-name") == 0 && index + 1 < argc) {
            target_name = argv[++index];
        } else if (strcmp(argv[index], "--max-file-bytes") == 0 && index + 1 < argc) {
            counters.max_file_bytes = parse_positive_u64(
                argv[++index],
                "max-file-bytes is invalid"
            );
        } else if (strcmp(argv[index], "--max-bytes") == 0 && index + 1 < argc) {
            counters.max_bytes = parse_positive_u64(argv[++index], "max-bytes is invalid");
        } else if (strcmp(argv[index], "--max-entries") == 0 && index + 1 < argc) {
            counters.max_entries = parse_positive_u64(argv[++index], "max-entries is invalid");
        } else if (strcmp(argv[index], "--max-depth") == 0 && index + 1 < argc) {
            maximum_depth = parse_positive_u64(argv[++index], "max-depth is invalid");
        } else if (strcmp(argv[index], "--exclude") == 0 && index + 1 < argc) {
            if (exclusions.length >= MAX_EXCLUDES || !safe_relative_path(argv[index + 1])) {
                die("exclude inventory is unsafe or unbounded");
            }
            exclusions.values[exclusions.length++] = argv[++index];
        } else {
            die("arguments are not exact");
        }
    }
    if (operation != NULL && strcmp(operation, "delete") == 0) {
        if (target_name == NULL || source_name != NULL || destination_name != NULL ||
            counters.max_file_bytes != 0U || counters.max_bytes != 0U ||
            counters.max_entries == 0U || maximum_depth == 0U ||
            exclusions.length != 0U || strlen(target_name) > MAX_NAME_BYTES ||
            !safe_relative_path(target_name) || strchr(target_name, '/') != NULL) {
            die("delete name or ceilings are invalid");
        }
        int parent = fcntl(4, F_DUPFD_CLOEXEC, 6);
        int root = fcntl(5, F_DUPFD_CLOEXEC, 6);
        if (parent < 0 || root < 0) {
            die_errno("required pinned delete descriptors are absent");
        }
        delete_root(parent, root, target_name, &counters, maximum_depth);
        if (close(parent) != 0 || close(root) != 0) {
            die_errno("cannot close delete roots");
        }
        printf(
            "{\"directories\":%llu,\"entries\":%llu,\"files\":%llu,\"schema\":\"oxigraph.g1.7-openat2-delete/v1\",\"symlinks\":%llu}\n",
            (unsigned long long)counters.directories,
            (unsigned long long)counters.entries,
            (unsigned long long)counters.files,
            (unsigned long long)counters.symlinks
        );
        return 0;
    }
    if (operation == NULL || strcmp(operation, "copy") != 0 ||
        target_name != NULL || maximum_depth != 0U ||
        source_name == NULL || destination_name == NULL ||
        counters.max_file_bytes == 0U || counters.max_bytes == 0U ||
        counters.max_entries == 0U ||
        strlen(source_name) > MAX_NAME_BYTES ||
        strlen(destination_name) > MAX_NAME_BYTES ||
        !safe_relative_path(source_name) || strchr(source_name, '/') != NULL ||
        !safe_relative_path(destination_name) || strchr(destination_name, '/') != NULL) {
        die("required names or ceilings are invalid");
    }
    int source_parent = fcntl(4, F_DUPFD_CLOEXEC, 6);
    int destination_parent = fcntl(5, F_DUPFD_CLOEXEC, 6);
    if (source_parent < 0 || destination_parent < 0) {
        die_errno("required pinned parent descriptors are absent");
    }
    struct stat source_parent_status;
    struct stat destination_parent_status;
    if (fstat(source_parent, &source_parent_status) != 0 ||
        fstat(destination_parent, &destination_parent_status) != 0 ||
        !S_ISDIR(source_parent_status.st_mode) ||
        !S_ISDIR(destination_parent_status.st_mode)) {
        die("pinned parent descriptors are not directories");
    }
    if (source_parent_status.st_dev == destination_parent_status.st_dev &&
        source_parent_status.st_ino == destination_parent_status.st_ino &&
        strcmp(source_name, destination_name) == 0) {
        die("source and destination identities overlap");
    }
    struct stat destination_status;
    if (fstatat(destination_parent, destination_name, &destination_status, AT_SYMLINK_NOFOLLOW) == 0 ||
        errno != ENOENT) {
        close(source_parent);
        close(destination_parent);
        die("destination already exists or cannot be inspected exclusively");
    }
    copy_entry(
        source_parent,
        source_name,
        destination_parent,
        destination_name,
        "",
        &exclusions,
        &counters
    );
    if (close(source_parent) != 0 || close(destination_parent) != 0) {
        die_errno("cannot close snapshot roots");
    }
    printf(
        "{\"bytes\":%llu,\"directories\":%llu,\"entries\":%llu,\"files\":%llu,\"schema\":\"oxigraph.g1.7-openat2-snapshot/v2\",\"symlinks\":%llu}\n",
        (unsigned long long)counters.bytes,
        (unsigned long long)counters.directories,
        (unsigned long long)counters.entries,
        (unsigned long long)counters.files,
        (unsigned long long)counters.symlinks
    );
    return 0;
}
