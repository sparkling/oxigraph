//! Optional source-derived NDV observations; never part of statistics.v1 bytes.
use super::{DerivedLimits, StatisticsError, controlled};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::num::NonZeroUsize;
use std::time::Instant;

const REGISTERS: usize = 1024;
#[cfg(feature = "rdf-12")]
pub(super) const PROFILE: &str =
    "oxigraph.statistics.distinct.sha256-hll10-fixed48.v1;codec=1;rdf12=true";
#[cfg(not(feature = "rdf-12"))]
pub(super) const PROFILE: &str =
    "oxigraph.statistics.distinct.sha256-hll10-fixed48.v1;codec=1;rdf12=false";
type ScopeKey = (Vec<u8>, String);
pub(super) type DistinctEstimates = BTreeMap<ScopeKey, (u64, u64)>;

/// Additional logical scratch/retained-state ceiling for optional distinct-value
/// estimates. This is separate from the physical statistics ceiling, not an RSS
/// quota. One source record and the ordinary verification buffers also coexist.
#[derive(Clone, Debug)]
pub struct DistinctStatisticsLimits {
    pub max_bytes: NonZeroUsize,
}
impl Default for DistinctStatisticsLimits {
    fn default() -> Self {
        Self {
            max_bytes: NonZeroUsize::new(4 * 1024 * 1024).unwrap_or(NonZeroUsize::MIN),
        }
    }
}

struct DistinctSketch {
    registers: [u8; REGISTERS],
}
impl DistinctSketch {
    fn new() -> Self {
        Self {
            registers: [0; REGISTERS],
        }
    }
    #[expect(
        clippy::expect_used,
        reason = "SHA-256 has a fixed 32-byte digest and the 54-bit suffix has rank <=55"
    )]
    fn insert(&mut self, term: &[u8], position: u8) {
        let mut hash = Sha256::new();
        hash.update(b"oxigraph.statistics.distinct.sha256-hll10.v1\0");
        hash.update([position]);
        hash.update(term);
        let hash = hash.finalize();
        let index = usize::from(u16::from_be_bytes([hash[0], hash[1]]) >> 6);
        let bits = u64::from_be_bytes(hash[..8].try_into().expect("SHA-256 has eight bytes"));
        let rank = u8::try_from((bits << 10).leading_zeros().min(54) + 1)
            .expect("a 54-bit suffix has rank at most 55");
        self.registers[index] = self.registers[index].max(rank);
    }
    fn estimate(&self, occurrences: u64) -> u64 {
        if occurrences == 0 {
            return 0;
        }
        // Exact scaled harmonic sum and rational alpha = .7213/(1+1.079/1024).
        // Rank <=55, sum <=2^65; numerator and denominator fit in u128.
        let (zeros, sum) = self
            .registers
            .iter()
            .fold((0_u128, 0_u128), |(zeros, sum), &r| {
                (zeros + u128::from(r == 0), sum + (1_u128 << (55 - r)))
            });
        let numerator = 7213_u128 * 1024 * 1024 * 1024 * (1_u128 << 55);
        let denominator = 10 * (1_024_000 + 1079) * sum;
        let estimate = if numerator <= 2560 * denominator && zeros != 0 {
            // Fixed 48-fractional-bit logarithm avoids platform libm rounding
            // in plans. Normalize the ratio to [1,2], then evaluate the first
            // 32 terms of ln(x)=2*(z+z^3/3+...), z=(x-1)/(x+1).
            let mut scaled_zeros = zeros;
            let mut shifts = 0;
            while scaled_zeros < 512 {
                scaled_zeros *= 2;
                shifts += 1;
            }
            let log = shifts * log_ratio_fixed48(2, 1) + log_ratio_fixed48(1024, scaled_zeros);
            (1024 * log + (1_u128 << 47)) >> 48
        } else {
            (numerator + denominator / 2) / denominator
        };
        u64::try_from(estimate)
            .unwrap_or(u64::MAX)
            .clamp(1, occurrences)
    }
}

/// Profile-defined integer approximation; callers supply 1 <= numerator/denominator <= 2.
fn log_ratio_fixed48(numerator: u128, denominator: u128) -> u128 {
    let z = ((numerator - denominator) << 48) / (numerator + denominator);
    let square = (z * z) >> 48;
    let mut power = z;
    let mut sum = 0;
    for n in 0..32_u128 {
        sum += power / (2 * n + 1);
        power = (power * square) >> 48;
    }
    2 * sum
}

pub(super) struct DistinctCollector {
    scopes: BTreeMap<ScopeKey, (DistinctSketch, DistinctSketch, u64)>,
    bytes: usize,
    max_bytes: usize,
}
impl DistinctCollector {
    pub(super) fn new(limits: &DistinctStatisticsLimits) -> Self {
        Self {
            scopes: BTreeMap::new(),
            bytes: 128,
            max_bytes: limits.max_bytes.get(),
        }
    }
    pub(super) fn insert(
        &mut self,
        key: &ScopeKey,
        subject: &[u8],
        object: &[u8],
    ) -> Result<(), StatisticsError> {
        if self.bytes > self.max_bytes {
            return Err(StatisticsError::Limit);
        }
        if !self.scopes.contains_key(key) {
            // Charge before allocation, including keys in both the scratch and
            // compact result maps, which can coexist during finalization.
            self.bytes = key
                .0
                .len()
                .checked_add(key.1.len())
                .and_then(|n| n.checked_mul(2))
                .and_then(|n| n.checked_add(2 * REGISTERS + 256))
                .and_then(|n| n.checked_add(self.bytes))
                .filter(|&n| n <= self.max_bytes)
                .ok_or(StatisticsError::Limit)?;
            self.scopes.insert(
                key.clone(),
                (DistinctSketch::new(), DistinctSketch::new(), 0),
            );
        }
        let (subjects, objects, count) =
            self.scopes.get_mut(key).ok_or(StatisticsError::Profile)?;
        *count = count.checked_add(1).ok_or(StatisticsError::Limit)?;
        subjects.insert(subject, 0);
        objects.insert(object, 1);
        Ok(())
    }
    pub(super) fn finish(
        self,
        limits: &DerivedLimits,
        started: Instant,
    ) -> Result<DistinctEstimates, StatisticsError> {
        if self.bytes > self.max_bytes {
            return Err(StatisticsError::Limit);
        }
        let mut result = BTreeMap::new();
        for (key, (subjects, objects, count)) in self.scopes {
            controlled(limits, started)?;
            result.insert(key, (subjects.estimate(count), objects.estimate(count)));
        }
        controlled(limits, started)?;
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn distinct_sketch_is_order_and_duplicate_invariant() {
        let mut forward = DistinctSketch::new();
        let mut reverse = DistinctSketch::new();
        assert_eq!(forward.estimate(0), 0);
        for i in 0_u64..10_000 {
            forward.insert(&i.to_be_bytes(), 0);
        }
        for i in (0_u64..10_000).rev() {
            reverse.insert(&i.to_be_bytes(), 0);
            reverse.insert(&i.to_be_bytes(), 0);
        }
        assert_eq!(forward.registers, reverse.registers);
        let estimate = forward.estimate(10_000);
        // Sanity on one deterministic fixture, not an advertised error bound.
        assert!((8_500..=10_000).contains(&estimate), "{estimate}");
        assert_eq!(forward.estimate(1), 1);
        let mut singleton = DistinctSketch::new();
        for _ in 0..100 {
            singleton.insert(b"same", 1);
        }
        assert_eq!(singleton.estimate(100), 1);
    }

    #[test]
    fn distinct_scratch_limit_is_checked_before_scope_allocation() {
        let mut collector = DistinctCollector::new(&DistinctStatisticsLimits {
            max_bytes: NonZeroUsize::MIN,
        });
        assert!(matches!(
            collector.insert(&(vec![], "urn:p".into()), b"s", b"o"),
            Err(StatisticsError::Limit)
        ));
        assert!(collector.scopes.is_empty());
        assert!(matches!(
            collector.finish(&DerivedLimits::default(), Instant::now()),
            Err(StatisticsError::Limit)
        ));
    }

    #[test]
    fn distinct_integer_estimation_handles_full_rank_and_small_range() {
        let maximal = DistinctSketch {
            registers: [55; REGISTERS],
        };
        assert_eq!(maximal.estimate(u64::MAX), u64::MAX);
        assert_eq!(maximal.estimate(7), 7);
        assert_eq!(maximal.estimate(0), 0);
        for (zeros, expected) in [(0, 2951), (52, 2561), (53, 3032)] {
            let mut sketch = DistinctSketch {
                registers: [2; REGISTERS],
            };
            sketch.registers[..zeros].fill(0);
            assert_eq!(sketch.estimate(u64::MAX), expected);
        }
        let mut mixed = DistinctSketch {
            registers: [4; REGISTERS],
        };
        mixed.registers[..512].fill(5);
        assert_eq!(mixed.estimate(u64::MAX), 15740);
        // Exhaust all small-range zero counts against an independent floating
        // diagnostic. Production rounding uses integers only.
        for zeros in 1_u32..=1024 {
            let mut scaled = u128::from(zeros);
            let mut shifts = 0;
            while scaled < 512 {
                scaled *= 2;
                shifts += 1;
            }
            let fixed = shifts * log_ratio_fixed48(2, 1) + log_ratio_fixed48(1024, scaled);
            let rounded = u32::try_from((1024 * fixed + (1_u128 << 47)) >> 48).unwrap();
            assert_eq!(
                f64::from(rounded),
                (1024.0 * (1024.0 / f64::from(zeros)).ln()).round()
            );
        }
    }
}
