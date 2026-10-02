'use client';

import { useState, type FormEvent } from 'react';
import {
  answerScreenshotStatsQuestion,
  type ScreenshotStatsMetric,
  type ScreenshotStatsPopulations,
  type ScreenshotStatsTour,
} from '@/lib/screenshotStatsQuestions';

type ScreenshotStatsExplorerProps = {
  initialTour: ScreenshotStatsTour;
  populations: ScreenshotStatsPopulations;
  metrics: ScreenshotStatsMetric[];
};

export default function ScreenshotStatsExplorer({
  initialTour,
  populations,
  metrics,
}: ScreenshotStatsExplorerProps) {
  const [question, setQuestion] = useState('');
  const [questionResult, setQuestionResult] = useState<string | null | undefined>(undefined);

  function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQuestionResult(
      answerScreenshotStatsQuestion(question, populations, metrics, initialTour),
    );
  }

  return (
    <section className="screenshot-explorer" aria-label="Screenshot statistics explorer">
      <header className="screenshot-explorer-heading">
        <div>
          <span className="screenshot-explorer-kicker">PLAYER DATA / MATCH ANALYSIS</span>
          <h2>About this snapshot</h2>
          <p>Ask a question about the published player values. Answers use the reconciled ATP and WTA singles snapshot.</p>
        </div>
        <div className="screenshot-explorer-stamp" aria-label="Published snapshot">
          <span className="screenshot-explorer-stamp-mark" aria-hidden="true">W</span>
          <span><b>Published</b><small>reconciled snapshot</small></span>
        </div>
      </header>

      <section className="screenshot-question" aria-labelledby="screenshot-question-title">
        <div className="screenshot-question-intro">
          <span className="screenshot-section-index">01 / ASK</span>
          <div>
            <h3 id="screenshot-question-title">Ask the snapshot</h3>
            <p>Answers are calculated from the published player values. Name ATP or WTA in your question to choose a tour.</p>
          </div>
        </div>
        <form className="screenshot-question-form" onSubmit={submitQuestion}>
          <label htmlFor="screenshot-question-input">Your question</label>
          <div className="screenshot-question-entry">
            <input
              id="screenshot-question-input"
              type="text"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Who has the most aces?"
              autoComplete="off"
            />
            <button className="btn btn-primary" type="submit">Get answer</button>
          </div>
          <p className="screenshot-question-examples">
            Try highest, lowest or best for a metric; the average; one player’s value; or a comparison between two players.
          </p>
        </form>
        {questionResult !== undefined ? (
          <div className={`screenshot-answer${questionResult === null ? ' is-uninterpreted' : ''}`} role="status" aria-live="polite">
            {questionResult === null ? (
              <p>
                I couldn’t interpret that question. Try asking for the highest, lowest or best metric, an average, one player’s metric, or a comparison between two named players.
              </p>
            ) : (
              <p>{questionResult}</p>
            )}
          </div>
        ) : null}
      </section>

    </section>
  );
}