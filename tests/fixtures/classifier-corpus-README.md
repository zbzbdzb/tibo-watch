# Classifier public-post corpus

`classifier-public-posts.json` is a frozen, manually labeled subset of the public posts saved by Tibo Watch on 2026-09-05. Capture used read-only SQLite access to posts/classifications only. Preserve captured text, punctuation, newlines, Unicode, truncation, kind, quotes and real IDs: add new snapshots instead of silently rewriting captured evidence. Missing parent text is deliberately not supplied.

The provenance SHA-256 covers JSON.stringify(cases.map(fixture => fixture.post)); the domain tests verify it and ensure every matched evidence term is a raw primary/quote substring. Labels concern only available text. Hint labels are explicitly lower certainty and do not imply a promised or completed reset.

Synthetic contrast examples live in tests/domain/classifier.test.ts and use synthetic-prefixed IDs, example.invalid URLs and synthetic-fixture source IDs. Never attach an existing real post ID to paraphrased or invented text.

This 35-post adjudicated subset is not a random or exhaustive accuracy benchmark. Full saved-corpus replay totals and level changes are documented in .superpowers/sdd/tibo-watch-reliability/classifier-report.md.
