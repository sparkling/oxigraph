# N3 submodule publication — 2026-09-07

The programme owner authorized implementation of the delivery-recovery
recommendations, including resolution of N3 distribution and publication.
The existing reviewed repair is now published on
[sparkling/N3 main](https://github.com/sparkling/N3/tree/main).

- Commit: `8a9ea8ed42ae0487b20803f5687017980bbe8e37`
- Tree: `f27062aad2b1a6e39844a4ac725b373ba6faff35`
- Declared remote: `https://github.com/sparkling/N3.git`
- Remote default branch: `main`
- Upstream: `https://github.com/w3c-cg/N3.git`

The parent repository's gitlink is unchanged. Only its declared remote and
tracking branch change. The two dependency/toolchain repair commits and their
reviewed generated grammar artifacts are preserved byte-for-byte. No upstream
branch is overwritten.

GitHub's commit endpoint and `git ls-remote` both resolve the published commit
and tree. A depth-one fetch of `refs/heads/main` into a newly initialized empty
bare object store also returned that exact commit and tree, without local
alternates or the existing submodule's objects.

The prior [maintenance receipt](n3-dependency-maintenance-receipt.json)
is retained unchanged: its August 31 publication hold describes the state at
that time, not the current remote. This publication does not replace semantic
qualification, refresh a protected baseline, or add a production claim.
