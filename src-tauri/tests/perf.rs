//! Performance budget checks (spec §8). Ignored by default; run in release:
//! `cargo test --release --test perf -- --ignored --nocapture`
//! Set `JULIEPDF_PERF_FIXTURES=<dir>` to also write the fixture PDFs there
//! (for measuring open times with pdf.js or the app).
#[allow(dead_code)]
mod fixtures;

use std::time::{Duration, Instant};

use juliepdf_lib::commands::files::save_to_path;
use juliepdf_lib::pdf::dto::{AnnotationDto, Blend, Common, InkRole};
use juliepdf_lib::pdf::reader::read_annotations;
use juliepdf_lib::pdf::writer::write_incremental;

const PAGES: usize = 50;
const ANNOTATIONS: usize = 100;
/// Points per stroke: about one second of pen input.
const POINTS: usize = 150;
const SAVE_BUDGET: Duration = Duration::from_millis(200);

fn pen_stroke(id: usize) -> AnnotationDto {
    let stroke = (0..POINTS)
        .map(|k| {
            let t = k as f64 / POINTS as f64;
            [100.0 + 300.0 * t, 400.0 + 40.0 * (t * 12.0 + id as f64).sin()]
        })
        .collect();
    AnnotationDto::Ink {
        common: Common {
            id: format!("ink-{id}"),
            page: (id % PAGES) as u32,
            source_ref: None,
            modified_at: "2026-11-19T10:00:00Z".into(),
            author: "JuliePDF".into(),
            flattened: false,
        },
        strokes: vec![stroke],
        color: [0.9, 0.1, 0.2],
        width: 2.0,
        opacity: 1.0,
        blend: Blend::Normal,
        role: InkRole::Pen,
        pressure: None,
    }
}

fn best_of<T>(runs: usize, mut f: impl FnMut() -> T) -> (Duration, T) {
    let mut best = Duration::MAX;
    let mut last = None;
    for _ in 0..runs {
        let t = Instant::now();
        let v = f();
        best = best.min(t.elapsed());
        last = Some(v);
    }
    (best, last.unwrap())
}

/// Times opening (annotation read), writing and saving 100 pen strokes; returns the save time.
fn measure(name: &str, original: &[u8], upserts: &[AnnotationDto]) -> Duration {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("lecture.pdf");
    std::fs::write(&source, original).unwrap();
    if let Some(out) = std::env::var_os("JULIEPDF_PERF_FIXTURES") {
        std::fs::write(std::path::Path::new(&out).join(format!("{name}.pdf")), original).unwrap();
    }
    println!("{name}: {PAGES} pages, {:.1} MB", original.len() as f64 / 1e6);

    let (open_read, existing) = best_of(5, || read_annotations(original).unwrap());
    assert!(existing.is_empty());
    println!("  read_annotations (open, no annotations): {open_read:?}");

    let (write, (bytes, refs)) = best_of(5, || write_incremental(original, upserts, &[]).unwrap());
    assert_eq!(refs.len(), ANNOTATIONS);
    println!("  write_incremental: {write:?}");

    let target = dir.path().join("saved.pdf");
    let (save, _) = best_of(5, || save_to_path(&source, &target, upserts, &[]).unwrap());
    println!("  save_to_path (read + write + fsync + rename): {save:?}");

    let (reread, got) = best_of(5, || read_annotations(&bytes).unwrap());
    assert_eq!(got.len(), ANNOTATIONS);
    println!("  read_annotations (100 annotations): {reread:?}");
    save
}

#[test]
#[ignore = "performance check; run with --release -- --ignored"]
fn save_budget_50_pages_100_inks() {
    let upserts: Vec<AnnotationDto> = (0..ANNOTATIONS).map(pen_stroke).collect();

    // The cost that does not scale with file size.
    let tiny = fixtures::simple_pdf(PAGES);
    let (tiny_write, _) = best_of(5, || write_incremental(&tiny, &upserts, &[]).unwrap());
    println!("write_incremental on a {} KB document: {tiny_write:?}", tiny.len() / 1000);

    let typical = measure("lecture-typical", &fixtures::lecture_pdf(PAGES, (320, 240)), &upserts);
    let large = measure("lecture-large", &fixtures::lecture_pdf(PAGES, (640, 480)), &upserts);
    assert!(typical < SAVE_BUDGET, "typical save took {typical:?}");
    assert!(large < SAVE_BUDGET, "large save took {large:?}");
}
