// Only load .env in local dev — Render injects env vars directly
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}
const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;
const RESULTS_FILE = path.join(__dirname, 'results.json');

app.use(cors());
app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

console.log('ANTHROPIC_API_KEY loaded:', process.env.ANTHROPIC_API_KEY ? `${process.env.ANTHROPIC_API_KEY.slice(0, 10)}…` : 'MISSING');

// Always read from env at call time so Render env vars are never stale
function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function readResults() {
  try {
    if (!fs.existsSync(RESULTS_FILE)) return [];
    return JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
  } catch { return []; }
}
function writeResults(data) {
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ── TEST ─────────────────────────────────────────────────────────────────────
app.get('/api/test', (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY;
  res.json({
    keyPresent: !!key,
    keyPreview: key ? key.slice(0, 10) : null
  });
});

// ── ANALYSE ──────────────────────────────────────────────────────────────────
app.post('/api/analyse', async (req, res) => {
  try {
    const { answers, traits, careers, questions, activities, grades } = req.body;

    const answersText = questions.map((q, i) => {
      const letter = answers[i];
      const option = q.options.find(o => o.letter === letter);
      return `Q${i + 1} [${q.section}]: ${q.text}\n   -> ${letter}: ${option ? option.label + ' — ' + option.text : 'No answer'}`;
    }).join('\n\n');

    const traitsText = Object.entries(traits)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k.charAt(0).toUpperCase() + k.slice(1)}: ${v}%`)
      .join(' | ');

    let activitiesText = '';
    if (activities) {
      const actList = Object.entries(activities).filter(([, v]) => v > 0).map(([k, v]) => `${k}: ${v}h/week`).join(', ');
      if (actList) activitiesText = `\n\nWeekly activities: ${actList}`;
    }

    let gradesText = '';
    if (grades && grades.subjects) {
      const gList = Object.entries(grades.subjects).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(', ');
      if (gList) gradesText = `\n\nAcademic grades: ${gList}`;
      if (grades.attendance) gradesText += `. Attendance: ${grades.attendance}%`;
      if (grades.participation) gradesText += `. Participation: ${grades.participation}`;
    }

    const promptText = `You are PathFinder, an expert AI career guidance counsellor for students aged 14-22.

All 25 student answers:
${answersText}

Trait scores: ${traitsText}
Suggested careers: ${careers.join(', ')}${activitiesText}${gradesText}

Write a warm personalised career analysis with these sections in bold:

**Who you are** - 2-3 sentences referencing their specific answers, make them feel seen.
**Your 3 strongest traits** - three bullet points each with a career implication.
**Top 3 career recommendations** - for each: why it fits them, what success looks like.
**Best university match** - one subject, two sentences why it fits.
**One honest challenge** - one paragraph naming a real challenge and how to turn it into a strength.

Speak as you. Warm, specific, direct. Max 420 words.`;

    const message = await getClient().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: promptText }]
    });

    res.json({ text: message.content[0].text });
  } catch (err) {
    console.error('Analysis error — status:', err.status, '| type:', err.error?.type, '| message:', err.message);
    res.status(500).json({ error: 'Failed to generate analysis', detail: err.message });
  }
});

// ── CHAT ─────────────────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, profile } = req.body;

    const system = `You are PathFinder AI Career Coach — warm, direct, and expert at guiding students aged 14-22.

Student profile:
- Top trait: ${profile.topTrait || 'unknown'}
- Trait scores: ${Object.entries(profile.traits || {}).map(([k, v]) => `${k}: ${v}%`).join(', ')}
- Suggested careers: ${(profile.careers || []).join(', ')}

Answer questions with empathy and specificity. Be concise — max 120 words per reply. Reference their profile when relevant.`;

    const message = await getClient().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      system,
      messages
    });

    res.json({ text: message.content[0].text });
  } catch (err) {
    console.error('Chat error — status:', err.status, '| type:', err.error?.type, '| message:', err.message);
    res.status(500).json({ error: 'Failed to respond', detail: err.message });
  }
});

// ── SAVE RESULT ───────────────────────────────────────────────────────────────
app.post('/api/save-result', (req, res) => {
  try {
    const { name, topTrait, topCareers, xp, xpLevel, engagementScore, date } = req.body;
    const results = readResults();
    results.unshift({
      id: Date.now(),
      name: (name || 'Anonymous').trim(),
      topTrait,
      topCareers,
      xp,
      xpLevel,
      engagementScore,
      date: date || new Date().toISOString()
    });
    writeResults(results);
    res.json({ ok: true });
  } catch (err) {
    console.error('Save error:', err.message);
    res.status(500).json({ error: 'Failed to save' });
  }
});

// ── GET RESULTS ───────────────────────────────────────────────────────────────
app.get('/api/results', (req, res) => {
  res.json(readResults());
});

app.listen(PORT, () => {
  console.log(`PathFinder running at http://localhost:${PORT}`);
});
