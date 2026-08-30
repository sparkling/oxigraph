#[cfg(test)]
mod tests {
    use oxrdf::{OxStr, OxString, ReserveError};
    use std::error::Error;
    use std::io;

    fn assert_public_error<T: Error + Send + Sync + 'static>() {}

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
}
