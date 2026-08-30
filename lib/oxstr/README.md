# OxStr

`OxStr` is a compact string type that can be either borrowed or
reference-counted owned data. It combines the useful storage properties of
`Arc<str>` and `Cow<'a, str>` in a two-word representation.

This workspace crate preserves the public API and provenance of upstream
[`oxstr`](https://github.com/oxigraph/oxstr) 0.1.0, whose published source is
identified by Git commit `8ac93420bfa22518516afb237e6b3728924b733e` and
crate SHA-256
`c8c3a7befbd89a2df6da36532ef7df41fbecdd702f4f405a10b085f6c30ad2bb`.
Its implementation is the hardened Oxigraph fork source from commit
`41fa5b5bfbd87d6b3a7a79c6ebd983bbe9e91920`, including fallible layout and
concatenation checks, bounded handling of unstable `AsRef<str>` values, and
allocation cleanup during errors and unwinding. The local path dependency is
intentional: the registry 0.1.0 implementation is not used by this workspace.

```rust
use oxstr::OxStr;

let borrowed = OxStr::new("hello");
let owned = OxStr::new_owned("hello");

assert_eq!(borrowed.as_str(), "hello");
assert_eq!(owned.as_str(), "hello");
assert_eq!(OxStr::concat(["foo", " ", "bar"]), "foo bar");
```

## License

This code retains the upstream dual licence and is available under either
[Apache License 2.0](../../LICENSE-APACHE) or [MIT](../../LICENSE-MIT), at your
option.
