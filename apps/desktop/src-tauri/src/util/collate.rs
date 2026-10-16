use std::cmp::Ordering;

use unicode_normalization::char::is_combining_mark;
use unicode_normalization::UnicodeNormalization;

fn fold(text: &str) -> Vec<char> {
    text.nfd().filter(|c| !is_combining_mark(*c)).flat_map(char::to_lowercase).collect()
}

fn digits_cmp(a: &[char], b: &[char]) -> Ordering {
    let a: Vec<char> = a.iter().copied().skip_while(|c| *c == '0').collect();
    let b: Vec<char> = b.iter().copied().skip_while(|c| *c == '0').collect();
    a.len().cmp(&b.len()).then_with(|| a.cmp(&b))
}

fn primary(a: &str, b: &str, numeric: bool) -> Ordering {
    let a = fold(a);
    let b = fold(b);
    let (mut i, mut j) = (0, 0);
    while i < a.len() && j < b.len() {
        if numeric && a[i].is_ascii_digit() && b[j].is_ascii_digit() {
            let si = i;
            while i < a.len() && a[i].is_ascii_digit() {
                i += 1;
            }
            let sj = j;
            while j < b.len() && b[j].is_ascii_digit() {
                j += 1;
            }
            let order = digits_cmp(&a[si..i], &b[sj..j]);
            if order != Ordering::Equal {
                return order;
            }
            continue;
        }
        let order = a[i].cmp(&b[j]);
        if order != Ordering::Equal {
            return order;
        }
        i += 1;
        j += 1;
    }
    (a.len() - i.min(a.len())).cmp(&(b.len() - j.min(b.len())))
}

fn tertiary(a: &str, b: &str) -> Ordering {
    let accents = |s: &str| s.nfd().filter(|c| is_combining_mark(*c)).count();
    accents(a).cmp(&accents(b)).then_with(|| {
        for (x, y) in a.chars().zip(b.chars()) {
            if x == y {
                continue;
            }
            if x.to_lowercase().eq(y.to_lowercase()) {
                return if x.is_lowercase() { Ordering::Less } else { Ordering::Greater };
            }
            return x.cmp(&y);
        }
        a.len().cmp(&b.len())
    })
}

pub fn compare(a: &str, b: &str) -> Ordering {
    primary(a, b, false).then_with(|| tertiary(a, b))
}

pub fn compare_numeric(a: &str, b: &str) -> Ordering {
    primary(a, b, true).then_with(|| tertiary(a, b))
}

pub fn compare_numeric_base(a: &str, b: &str) -> Ordering {
    primary(a, b, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn natural_order() {
        let mut names = vec!["file10", "file2", "File1", "b", "a"];
        names.sort_by(|a, b| compare_numeric(a, b));
        assert_eq!(names, vec!["a", "b", "File1", "file2", "file10"]);
        assert_eq!(compare_numeric_base("Todo", "todo"), Ordering::Equal);
        assert_eq!(compare("a", "A"), Ordering::Less);
        assert_eq!(compare("é", "f"), Ordering::Less);
    }
}
