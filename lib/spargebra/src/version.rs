use crate::{Query, SparqlSyntaxError, Update, ast};
use std::fmt;
use std::ops::Deref;

/// The SPARQL language version used for parsing and evaluation.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[non_exhaustive]
pub enum SparqlVersion {
    /// SPARQL 1.1.
    V1_1,
    /// SPARQL 1.2 basic feature mode, without triple terms.
    V1_2Basic,
    /// SPARQL 1.2 feature mode, including triple terms.
    V1_2,
}

impl SparqlVersion {
    /// The newest version supported by this build.
    #[inline]
    pub const fn current() -> Self {
        if cfg!(feature = "sparql-12") {
            Self::V1_2
        } else {
            Self::V1_1
        }
    }

    /// The standard version label.
    #[inline]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::V1_1 => "1.1",
            Self::V1_2Basic => "1.2-basic",
            Self::V1_2 => "1.2",
        }
    }

    /// Whether this version is supported by the enabled crate features.
    #[inline]
    pub const fn is_supported(self) -> bool {
        matches!(self, Self::V1_1) || cfg!(feature = "sparql-12")
    }

    #[cfg(feature = "sparql-12")]
    fn from_label(value: &str) -> Option<Self> {
        match value {
            "1.1" => Some(Self::V1_1),
            "1.2-basic" => Some(Self::V1_2Basic),
            "1.2" => Some(Self::V1_2),
            _ => None,
        }
    }
}

impl fmt::Display for SparqlVersion {
    #[inline]
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// A parsed query together with its SPARQL version metadata.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct ParsedQuery {
    query: Query,
    declared_version: Option<SparqlVersion>,
    effective_version: SparqlVersion,
}

impl ParsedQuery {
    pub(crate) fn new(
        query: Query,
        declared_version: Option<SparqlVersion>,
        effective_version: SparqlVersion,
    ) -> Self {
        Self {
            query,
            declared_version,
            effective_version,
        }
    }

    /// The parsed query algebra.
    #[inline]
    pub fn query(&self) -> &Query {
        &self.query
    }

    /// Consumes this value and returns the query algebra.
    #[inline]
    pub fn into_query(self) -> Query {
        self.query
    }

    /// The version declared with `VERSION`, if any.
    #[inline]
    pub const fn declared_version(&self) -> Option<SparqlVersion> {
        self.declared_version
    }

    /// The configured or declared version used to validate the query.
    #[inline]
    pub const fn effective_version(&self) -> SparqlVersion {
        self.effective_version
    }
}

impl AsRef<Query> for ParsedQuery {
    #[inline]
    fn as_ref(&self) -> &Query {
        &self.query
    }
}

impl Deref for ParsedQuery {
    type Target = Query;

    #[inline]
    fn deref(&self) -> &Self::Target {
        &self.query
    }
}

/// A parsed update together with its SPARQL version metadata.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct ParsedUpdate {
    update: Update,
    declared_version: Option<SparqlVersion>,
    effective_version: SparqlVersion,
}

impl ParsedUpdate {
    pub(crate) fn new(
        update: Update,
        declared_version: Option<SparqlVersion>,
        effective_version: SparqlVersion,
    ) -> Self {
        Self {
            update,
            declared_version,
            effective_version,
        }
    }

    /// The parsed update algebra.
    #[inline]
    pub fn update(&self) -> &Update {
        &self.update
    }

    /// Consumes this value and returns the update algebra.
    #[inline]
    pub fn into_update(self) -> Update {
        self.update
    }

    /// The version declared with `VERSION`, if any.
    #[inline]
    pub const fn declared_version(&self) -> Option<SparqlVersion> {
        self.declared_version
    }

    /// The configured or declared version used to validate the update.
    #[inline]
    pub const fn effective_version(&self) -> SparqlVersion {
        self.effective_version
    }
}

impl AsRef<Update> for ParsedUpdate {
    #[inline]
    fn as_ref(&self) -> &Update {
        &self.update
    }
}

impl Deref for ParsedUpdate {
    type Target = Update;

    #[inline]
    fn deref(&self) -> &Self::Target {
        &self.update
    }
}

#[cfg(not(feature = "sparql-12"))]
#[expect(
    clippy::unnecessary_wraps,
    reason = "keeps feature-independent parser call sites"
)]
pub(crate) fn declared_version<'a>(
    _prologue: impl IntoIterator<Item = &'a ast::PrologueDecl<'a>>,
    _source: &str,
) -> Result<Option<SparqlVersion>, SparqlSyntaxError> {
    Ok(None)
}

#[cfg(feature = "sparql-12")]
pub(crate) fn declared_version<'a>(
    prologue: impl IntoIterator<Item = &'a ast::PrologueDecl<'a>>,
    source: &str,
) -> Result<Option<SparqlVersion>, SparqlSyntaxError> {
    let mut result = None;
    for declaration in prologue {
        if let ast::PrologueDecl::Version(label) = declaration {
            let version = SparqlVersion::from_label(label).ok_or_else(|| {
                SparqlSyntaxError::new(
                    format!("Unsupported SPARQL version announcement '{label}'"),
                    source,
                )
            })?;
            // The SPARQL 1.2 grammar permits VERSION declarations to be
            // repeated in the prologue. Treat the effective requirement as
            // the strongest announced version so that every declaration is
            // honoured independently of declaration order.
            result = Some(result.map_or(version, |previous: SparqlVersion| previous.max(version)));
        }
    }
    Ok(result)
}

pub(crate) fn validate_version_support(
    version: SparqlVersion,
    source: &str,
) -> Result<(), SparqlSyntaxError> {
    if version.is_supported() {
        Ok(())
    } else {
        Err(SparqlSyntaxError::new(
            format!("SPARQL {version} requires the 'sparql-12' crate feature"),
            source,
        ))
    }
}

pub(crate) fn validate_version_syntax(
    source: &str,
    version: SparqlVersion,
) -> Result<(), SparqlSyntaxError> {
    let code = mask_comments_strings_and_iris(source);
    match version {
        SparqlVersion::V1_1 => {
            const FUNCTIONS: &[&[u8]] = &[
                b"LANGDIR",
                b"STRLANGDIR",
                b"hasLANG",
                b"hasLANGDIR",
                b"isTRIPLE",
                b"TRIPLE",
                b"SUBJECT",
                b"PREDICATE",
                b"OBJECT",
            ];
            if contains_bytes(&code, b"<<")
                || contains_bytes(&code, b"{|")
                || contains_unescaped_byte(&code, b'~')
                || has_directional_language_tag(&code)
                || FUNCTIONS.iter().any(|name| has_function_call(&code, name))
            {
                return Err(SparqlSyntaxError::new(
                    "The effective SPARQL 1.1 version does not allow SPARQL 1.2 syntax",
                    source,
                ));
            }
        }
        SparqlVersion::V1_2Basic => {
            const FUNCTIONS: &[&[u8]] =
                &[b"isTRIPLE", b"TRIPLE", b"SUBJECT", b"PREDICATE", b"OBJECT"];
            if contains_bytes(&code, b"<<(")
                || has_nested_reified_triple(&code)
                || FUNCTIONS.iter().any(|name| has_function_call(&code, name))
            {
                return Err(SparqlSyntaxError::new(
                    "The effective SPARQL 1.2-basic version does not allow triple terms or nested reified triple patterns",
                    source,
                ));
            }
        }
        SparqlVersion::V1_2 => {}
    }
    Ok(())
}

fn mask_comments_strings_and_iris(source: &str) -> Vec<u8> {
    let bytes = source.as_bytes();
    let mut code = bytes.to_vec();
    let mut cursor = 0;
    while cursor < bytes.len() {
        match bytes[cursor] {
            b'#' if !is_backslash_escaped(bytes, cursor) => {
                let start = cursor;
                while cursor < bytes.len() && bytes[cursor] != b'\n' {
                    cursor += 1;
                }
                code[start..cursor].fill(b' ');
            }
            quote @ (b'\'' | b'"') if !is_backslash_escaped(bytes, cursor) => {
                let start = cursor;
                let long =
                    bytes.get(cursor + 1) == Some(&quote) && bytes.get(cursor + 2) == Some(&quote);
                cursor += if long { 3 } else { 1 };
                while cursor < bytes.len() {
                    if bytes[cursor] == b'\\' {
                        cursor = (cursor + 2).min(bytes.len());
                    } else if long
                        && bytes.get(cursor) == Some(&quote)
                        && bytes.get(cursor + 1) == Some(&quote)
                        && bytes.get(cursor + 2) == Some(&quote)
                    {
                        cursor += 3;
                        break;
                    } else if !long && bytes[cursor] == quote {
                        cursor += 1;
                        break;
                    } else {
                        cursor += 1;
                    }
                }
                code[start..cursor].fill(b' ');
            }
            b'<' if bytes.get(cursor + 1) != Some(&b'<')
                && bytes.get(cursor + 1) != Some(&b'=') =>
            {
                if let Some(end) = iri_ref_end(bytes, cursor) {
                    code[cursor..end].fill(b' ');
                    cursor = end;
                } else {
                    cursor += 1;
                }
            }
            _ => cursor += 1,
        }
    }
    code
}

fn iri_ref_end(bytes: &[u8], start: usize) -> Option<usize> {
    for (offset, byte) in bytes.get(start + 1..)?.iter().enumerate() {
        if *byte == b'>' {
            return Some(start + offset + 2);
        }
        if byte.is_ascii_whitespace()
            || matches!(*byte, b'<' | b'"' | b'{' | b'}' | b'|' | b'^' | b'`')
        {
            return None;
        }
    }
    None
}

fn contains_bytes(haystack: &[u8], needle: &[u8]) -> bool {
    haystack
        .windows(needle.len())
        .any(|window| window == needle)
}

fn contains_unescaped_byte(bytes: &[u8], target: u8) -> bool {
    bytes
        .iter()
        .enumerate()
        .any(|(position, byte)| *byte == target && !is_backslash_escaped(bytes, position))
}

fn is_backslash_escaped(bytes: &[u8], position: usize) -> bool {
    let mut backslashes = 0;
    let mut cursor = position;
    while cursor > 0 && bytes.get(cursor - 1) == Some(&b'\\') {
        backslashes += 1;
        cursor -= 1;
    }
    backslashes % 2 == 1
}

fn has_function_call(code: &[u8], name: &[u8]) -> bool {
    if name.len() > code.len() {
        return false;
    }
    for start in 0..=code.len() - name.len() {
        if !code[start..start + name.len()].eq_ignore_ascii_case(name)
            || start
                .checked_sub(1)
                .and_then(|previous| code.get(previous))
                .is_some_and(|byte| is_name_byte(*byte))
            || code
                .get(start + name.len())
                .is_some_and(|byte| is_name_byte(*byte))
        {
            continue;
        }
        let mut after = start + name.len();
        while code.get(after).is_some_and(u8::is_ascii_whitespace) {
            after += 1;
        }
        if code.get(after) == Some(&b'(') {
            return true;
        }
    }
    false
}

fn is_name_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b':' | b'?' | b'$')
}

fn has_directional_language_tag(code: &[u8]) -> bool {
    for marker in [b"--ltr".as_slice(), b"--rtl".as_slice()] {
        if marker.len() > code.len() {
            continue;
        }
        for position in 0..=code.len() - marker.len() {
            if !code[position..position + marker.len()].eq_ignore_ascii_case(marker)
                || code
                    .get(position + marker.len())
                    .is_some_and(|byte| byte.is_ascii_alphanumeric() || *byte == b'-')
            {
                continue;
            }
            let mut tag_start = position;
            while tag_start > 0
                && code
                    .get(tag_start - 1)
                    .is_some_and(|byte| byte.is_ascii_alphanumeric() || *byte == b'-')
            {
                tag_start -= 1;
            }
            if tag_start > 0 && code.get(tag_start - 1) == Some(&b'@') {
                return true;
            }
        }
    }
    false
}

fn has_nested_reified_triple(code: &[u8]) -> bool {
    let mut depth = 0_u32;
    let mut cursor = 0;
    while cursor + 1 < code.len() {
        if code[cursor..].starts_with(b"<<(") {
            return true;
        }
        if code[cursor..].starts_with(b"<<") {
            depth += 1;
            if depth > 1 {
                return true;
            }
            cursor += 2;
        } else if code[cursor..].starts_with(b">>") {
            depth = depth.saturating_sub(1);
            cursor += 2;
        } else {
            cursor += 1;
        }
    }
    false
}

#[cfg(test)]
#[path = "version_tests.rs"]
mod tests;
