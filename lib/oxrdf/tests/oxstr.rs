#[cfg(test)]
mod tests {
    use oxrdf::{OxStr, OxString, ReserveError};
    use std::borrow::Borrow;
    use std::cell::Cell;
    use std::collections::hash_map::DefaultHasher;
    use std::error::Error;
    use std::hash::{Hash, Hasher};
    use std::io;
    use std::mem::size_of;

    fn assert_public_error<T: Error + Send + Sync + 'static>() {}

    fn assert_owned_traits<T: Clone + Eq + Ord + Hash + Send + Sync + 'static>() {}

    fn classify_error(error: &ReserveError) -> &'static str {
        match error {
            ReserveError::CapacityOverflow => "capacity",
            ReserveError::AllocError { .. } => "allocation",
            _ => "future",
        }
    }

    #[test]
    fn fallible_owned_string_api_exposes_reserve_error() {
        assert_public_error::<ReserveError>();

        let owned: Result<OxString, ReserveError> = OxStr::try_new_owned("abc");
        assert_eq!(owned.unwrap(), "abc");

        let concatenated: Result<OxString, ReserveError> = OxStr::try_concat(["ab", "cd"]);
        assert_eq!(concatenated.unwrap(), "abcd");

        let error = ReserveError::CapacityOverflow;
        assert_eq!(classify_error(&error), "capacity");

        let error: io::Error = error.into();
        assert_eq!(error.kind(), io::ErrorKind::OutOfMemory);
    }

    #[test]
    fn public_layout_and_clone_semantics_remain_compact() {
        assert_owned_traits::<OxString>();
        assert_eq!(size_of::<OxString>(), size_of::<usize>() * 2);
        assert_eq!(size_of::<Option<OxString>>(), size_of::<OxString>());

        let source = String::from("borrowed");
        let borrowed = OxStr::new(&source);
        assert_eq!(borrowed.as_str().as_ptr(), source.as_ptr());
        assert_eq!(borrowed.clone().get_mut(), None);

        let mut owned = OxString::new_owned("owned");
        let shared = owned.clone();
        assert_eq!(owned.as_str().as_ptr(), shared.as_str().as_ptr());
        assert_eq!(owned.get_mut(), None);
        drop(shared);
        assert_eq!(owned.get_mut().as_deref(), Some("owned"));
    }

    #[test]
    fn copy_on_write_detaches_borrowed_and_shared_values() {
        let borrowed = OxStr::new("alpha");
        let mut borrowed_copy = borrowed.clone();
        borrowed_copy.make_mut().make_ascii_uppercase();
        assert_eq!(borrowed, "alpha");
        assert_eq!(borrowed_copy, "ALPHA");

        let shared = OxString::new_owned("beta");
        let mut shared_copy = shared.clone();
        assert_eq!(shared.as_str().as_ptr(), shared_copy.as_str().as_ptr());
        shared_copy.make_mut().make_ascii_uppercase();
        assert_eq!(shared, "beta");
        assert_eq!(shared_copy, "BETA");
        assert_ne!(shared.as_str().as_ptr(), shared_copy.as_str().as_ptr());
    }

    #[test]
    fn value_traits_match_str_for_borrowed_and_owned_values() {
        let borrowed = OxStr::new("alpha");
        let owned = OxString::new_owned("alpha");
        assert_eq!(borrowed, owned);
        assert_eq!(<OxStr<'_> as Borrow<str>>::borrow(&borrowed), "alpha");
        assert_eq!(borrowed.to_string(), "alpha");
        assert_eq!(format!("{borrowed:?}"), "\"alpha\"");

        let mut string_hasher = DefaultHasher::new();
        "alpha".hash(&mut string_hasher);
        let mut oxstr_hasher = DefaultHasher::new();
        owned.hash(&mut oxstr_hasher);
        assert_eq!(string_hasher.finish(), oxstr_hasher.finish());

        let mut ordered = [
            OxString::from(String::from("charlie")),
            OxString::from("alpha"),
            OxString::from("bravo"),
        ];
        ordered.sort();
        assert_eq!(
            ordered.map(|value| value.to_string()),
            ["alpha", "bravo", "charlie"]
        );
        assert_eq!(OxString::default(), "");
    }

    struct ChangingAsRef {
        calls: Cell<usize>,
        first: &'static str,
        second: &'static str,
    }

    impl ChangingAsRef {
        fn new(first: &'static str, second: &'static str) -> Self {
            Self {
                calls: Cell::new(0),
                first,
                second,
            }
        }
    }

    impl AsRef<str> for ChangingAsRef {
        fn as_ref(&self) -> &str {
            let call = self.calls.get();
            self.calls.set(call + 1);
            if call == 0 { self.first } else { self.second }
        }
    }

    #[test]
    fn fallible_concat_bounds_unstable_as_ref_implementations() {
        for (first, second) in [("a", "longer"), ("longer", "a")] {
            let value = ChangingAsRef::new(first, second);
            assert_eq!(
                OxStr::try_concat(std::slice::from_ref(&value)),
                Err(ReserveError::CapacityOverflow)
            );
            assert_eq!(value.calls.get(), 2);
        }

        let first = ChangingAsRef::new("a", "longer");
        let second = ChangingAsRef::new("longer", "a");
        let result = OxStr::try_concat([&first, &second]).unwrap();
        assert_eq!(result, "longera");
        assert_eq!(first.calls.get(), 2);
        assert_eq!(second.calls.get(), 2);
    }

    #[test]
    fn fallible_concat_preserves_empty_and_ordered_inputs() {
        assert_eq!(OxStr::try_concat::<&str>([]).unwrap(), "");
        assert_eq!(OxStr::try_concat(["ab", "cd", "ef"]).unwrap(), "abcdef");
    }

    #[cfg(feature = "serde")]
    #[test]
    fn serde_round_trip_preserves_owned_string_value() {
        let value = OxString::new_owned("serde");
        let encoded = serde_json::to_string(&value).unwrap();
        assert_eq!(encoded, "\"serde\"");
        let decoded: OxString = serde_json::from_str(&encoded).unwrap();
        assert_eq!(decoded, value);
    }
}
