const express = require('express');
const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const { parse } = require('csv-parse/sync');

// Load environment variables from .env in parent directory
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const PORT = process.env.PORT || 3000;

// Azure OpenAI Configuration
const AZURE_OPENAI_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT;
const AZURE_OPENAI_API_KEY = process.env.AZURE_OPENAI_API_KEY;

// Azure Speech Configuration
const AZURE_SPEECH_TTS_ENDPOINT = process.env.AZURE_SPEECH_TTS_ENDPOINT;
const AZURE_SPEECH_STT_ENDPOINT = process.env.AZURE_SPEECH_STT_ENDPOINT;
const AZURE_SPEECH_API_KEY = process.env.AZURE_SPEECH_API_KEY;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Serve profile pictures
app.use('/pictures', express.static(path.join(__dirname, '..', 'pictures')));

// Database setup
let db;
const DB_PATH = path.join(__dirname, 'swipes.db');

async function initDatabase() {
  const SQL = await initSqlJs();
  
  // Load existing database or create new one
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }
  
  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS swipes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      swiped_user_id TEXT NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('left', 'right')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, swiped_user_id)
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      target_user_id TEXT NOT NULL,
      transcript TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  saveDatabase();
}

function saveDatabase() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// Load profiles from CSV
let profiles = [];

function loadProfiles() {
  const csvPath = path.join(__dirname, '..', 'data', 'cupid_matchmaking', 'data', 'dataset_cupid_matchmaking.csv');
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  profiles = parse(csvContent, {
    columns: true,
    skip_empty_lines: true
  });
  console.log(`Loaded ${profiles.length} profiles`);
}

loadProfiles();

// API: Lookup user by name
app.get('/api/login/:name', (req, res) => {
  const searchName = req.params.name.toLowerCase();
  const user = profiles.find(p => p.name.toLowerCase().includes(searchName));
  
  if (user) {
    res.json({ success: true, user: { user_id: user.user_id, name: user.name } });
  } else {
    res.json({ success: false, message: 'User not found' });
  }
});

// API: Get profiles to swipe (excluding self and already swiped)
app.get('/api/profiles/:userId', (req, res) => {
  const userId = req.params.userId;
  
  // Get already swiped profiles
  const stmt = db.prepare('SELECT swiped_user_id FROM swipes WHERE user_id = ?');
  stmt.bind([userId]);
  const swipedIds = new Set();
  while (stmt.step()) {
    swipedIds.add(stmt.getAsObject().swiped_user_id);
  }
  stmt.free();
  
  // Filter profiles
  const availableProfiles = profiles.filter(p => 
    p.user_id !== userId && !swipedIds.has(p.user_id)
  );
  
  res.json(availableProfiles);
});

// API: Record a swipe
app.post('/api/swipe', (req, res) => {
  const { userId, swipedUserId, direction } = req.body;
  
  if (!userId || !swipedUserId || !['left', 'right'].includes(direction)) {
    return res.status(400).json({ error: 'Invalid swipe data' });
  }
  
  try {
    db.run(`
      INSERT OR REPLACE INTO swipes (user_id, swiped_user_id, direction, created_at)
      VALUES (?, ?, ?, datetime('now'))
    `, [userId, swipedUserId, direction]);
    saveDatabase();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Get user's liked profiles (right swipes) with engagement data
app.get('/api/likes/:userId', (req, res) => {
  const userId = req.params.userId;
  const currentUser = profiles.find(p => p.user_id === userId);
  
  const stmt = db.prepare(`
    SELECT swiped_user_id FROM swipes 
    WHERE user_id = ? AND direction = 'right'
    ORDER BY created_at DESC
  `);
  stmt.bind([userId]);
  const likedIds = [];
  while (stmt.step()) {
    likedIds.push(stmt.getAsObject().swiped_user_id);
  }
  stmt.free();
  
  const likedProfiles = profiles.filter(p => likedIds.includes(p.user_id)).map(targetUser => {
    // Get last feedback date
    const feedbackStmt = db.prepare(`
      SELECT created_at FROM feedback 
      WHERE user_id = ? AND target_user_id = ?
      ORDER BY created_at DESC LIMIT 1
    `);
    feedbackStmt.bind([userId, targetUser.user_id]);
    let lastFeedbackDate = null;
    if (feedbackStmt.step()) {
      lastFeedbackDate = feedbackStmt.getAsObject().created_at;
    }
    feedbackStmt.free();
    
    // Calculate matching score (same algorithm as dashboard)
    let matchingScore = 0;
    if (currentUser) {
      const yourInterests = currentUser.interests.split(',').map(i => i.trim());
      const theirInterests = targetUser.interests.split(',').map(i => i.trim());
      const sharedInterests = yourInterests.filter(i => theirInterests.includes(i));
      const interestScore = Math.min((sharedInterests.length / Math.max(yourInterests.length, 1)) * 100, 100);
      
      const traits = ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'];
      let personalityScore = 0;
      traits.forEach(trait => {
        const diff = Math.abs(parseFloat(currentUser[trait]) - parseFloat(targetUser[trait]));
        personalityScore += (1 - diff) * 20;
      });
      
      const yourAge = parseInt(currentUser.age);
      const theirPrefMin = parseInt(targetUser.pref_age_min);
      const theirPrefMax = parseInt(targetUser.pref_age_max);
      const ageCompatible = yourAge >= theirPrefMin && yourAge <= theirPrefMax;
      const ageScore = ageCompatible ? 100 : Math.max(0, 100 - Math.abs(yourAge - (theirPrefMin + theirPrefMax) / 2) * 5);
      
      matchingScore = Math.round((interestScore * 0.3) + (personalityScore * 0.5) + (ageScore * 0.2));
    }
    
    return {
      ...targetUser,
      lastFeedbackDate,
      matchingScore,
      isPromising: matchingScore >= 50
    };
  });
  
  res.json(likedProfiles);
});

// API: Delete a like (remove swipe record)
app.delete('/api/likes/:userId/:swipedUserId', (req, res) => {
  const { userId, swipedUserId } = req.params;
  
  try {
    db.run(`DELETE FROM swipes WHERE user_id = ? AND swiped_user_id = ?`, [userId, swipedUserId]);
    saveDatabase();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Remove all data for a match (swipes + feedback)
app.delete('/api/match/:userId/:targetUserId', (req, res) => {
  const { userId, targetUserId } = req.params;
  
  try {
    db.run(`DELETE FROM swipes WHERE user_id = ? AND swiped_user_id = ?`, [userId, targetUserId]);
    db.run(`DELETE FROM feedback WHERE user_id = ? AND target_user_id = ?`, [userId, targetUserId]);
    saveDatabase();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Get phone number for a user
app.get('/api/phone/:userId', (req, res) => {
  const { userId } = req.params;
  const user = profiles.find(p => p.user_id === userId);
  
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  // Generate a fake phone number based on region
  const regionCodes = {
    'North America': '+1',
    'Europe': '+44',
    'Asia': '+81',
    'Australia': '+61',
    'South America': '+55',
    'Africa': '+27'
  };
  
  const code = regionCodes[user.location_region] || '+1';
  const hash = user.user_id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const phone = `${code} (${String(hash % 900 + 100)}) ${String(hash % 900 + 100)}-${String(hash % 9000 + 1000)}`;
  
  res.json({ name: user.name, phone });
});

// API: Get dating advice for a profile using LLM
app.get('/api/advice/:userId/:targetUserId', async (req, res) => {
  const { userId, targetUserId } = req.params;
  
  const currentUser = profiles.find(p => p.user_id === userId);
  const targetUser = profiles.find(p => p.user_id === targetUserId);
  
  if (!currentUser || !targetUser) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  // Parse shared interests for display
  const yourInterests = currentUser.interests.split(',').map(i => i.trim());
  const theirInterests = targetUser.interests.split(',').map(i => i.trim());
  const sharedInterests = yourInterests.filter(i => theirInterests.includes(i));
  const dealbreakers = targetUser.dealbreakers.split(',').map(d => d.trim());
  
  // Check for obvious incompatibilities
  const redFlags = [];
  const yourAge = parseInt(currentUser.age);
  const theirPrefMin = parseInt(targetUser.pref_age_min);
  const theirPrefMax = parseInt(targetUser.pref_age_max);
  
  // Age preference check
  if (yourAge < theirPrefMin || yourAge > theirPrefMax) {
    redFlags.push(`You are ${yourAge}, but they prefer ages ${theirPrefMin}-${theirPrefMax}.`);
  }
  
  // Location compatibility check
  if (currentUser.location_region !== targetUser.location_region) {
    if (dealbreakers.includes('long_distance') || dealbreakers.includes('different_timezone')) {
      redFlags.push(`You're in ${currentUser.location_region}, they're in ${targetUser.location_region}, and they have dealbreakers about distance/timezone.`);
    }
  }
  
  // Check your dealbreakers against their profile
  const yourDealbreakers = currentUser.dealbreakers.split(',').map(d => d.trim());
  if (yourDealbreakers.includes('age_gap')) {
    const ageDiff = Math.abs(yourAge - parseInt(targetUser.age));
    if (ageDiff > 15) {
      redFlags.push(`There's a ${ageDiff} year age gap, and you have age_gap as a dealbreaker.`);
    }
  }
  
  const recommendDate = redFlags.length === 0;
  
  // Build prompt for LLM
  const prompt = `You are a dating coach helping someone connect with a potential match. Based on the profile data below, provide personalized dating advice.

YOUR PROFILE:
- Name: ${currentUser.name}
- Age: ${currentUser.age}
- Location: ${currentUser.location_region}
- Interests: ${currentUser.interests}
- Personality (0-1 scale): Openness: ${currentUser.openness}, Conscientiousness: ${currentUser.conscientiousness}, Extraversion: ${currentUser.extraversion}, Agreeableness: ${currentUser.agreeableness}, Neuroticism: ${currentUser.neuroticism}

THEIR PROFILE (your match):
- Name: ${targetUser.name}
- Age: ${targetUser.age}
- Location: ${targetUser.location_region}
- Interests: ${targetUser.interests}
- Personality (0-1 scale): Openness: ${targetUser.openness}, Conscientiousness: ${targetUser.conscientiousness}, Extraversion: ${targetUser.extraversion}, Agreeableness: ${targetUser.agreeableness}, Neuroticism: ${targetUser.neuroticism}
- Dealbreakers: ${targetUser.dealbreakers}
- Match history: ${targetUser.matches_success} successful out of ${targetUser.matches_attempted} attempts
- Preferred age range: ${theirPrefMin} to ${theirPrefMax}

KNOWN COMPATIBILITY ISSUES:
${redFlags.length > 0 ? redFlags.join('\n') : 'None detected - looks promising!'}

Provide advice in this exact JSON format:
{
  "generalAdvice": "A 2-3 sentence overall assessment. If there are serious compatibility issues, be honest but kind about recommending they reconsider. If compatible, be encouraging.",
  "talkingPoints": ["point 1", "point 2", "point 3"],
  "avoidList": ["thing to avoid 1", "thing to avoid 2"],
  "compatibility": ["insight 1", "insight 2"]
}

Make the advice specific, warm, and actionable. Reference their actual interests and personality traits. For dealbreakers, explain what to avoid without being negative. Keep each point concise (1-2 sentences max).`;

  try {
    const response = await fetch(AZURE_OPENAI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': AZURE_OPENAI_API_KEY
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'You are a helpful dating coach. Always respond with valid JSON only, no markdown.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 800
      })
    });

    if (!response.ok) {
      throw new Error(`Azure OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    
    // Parse the JSON response
    let advice;
    try {
      // Remove any markdown code blocks if present
      const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      advice = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error('Failed to parse LLM response:', content);
      throw new Error('Failed to parse advice');
    }

    res.json({
      targetName: targetUser.name,
      targetAge: targetUser.age,
      targetRegion: targetUser.location_region,
      sharedInterests,
      generalAdvice: advice.generalAdvice || '',
      recommendDate,
      redFlags,
      talkingPoints: advice.talkingPoints || [],
      avoidList: advice.avoidList || [],
      compatibility: advice.compatibility || [],
      dealbreakers
    });
  } catch (error) {
    console.error('Error getting advice:', error);
    
    // Fallback to basic advice if LLM fails
    const fallbackGeneral = redFlags.length > 0
      ? `There are some compatibility concerns to consider: ${redFlags.join(' ')} You may want to think carefully before pursuing this match.`
      : `This looks like a promising match! You have things in common and no obvious dealbreakers.`;
    
    res.json({
      targetName: targetUser.name,
      targetAge: targetUser.age,
      targetRegion: targetUser.location_region,
      sharedInterests,
      generalAdvice: fallbackGeneral,
      recommendDate,
      redFlags,
      talkingPoints: [
        sharedInterests.length > 0 
          ? `You both enjoy ${sharedInterests.join(' and ')} - great conversation starters!`
          : `Ask about their interests in ${theirInterests[0]} to learn something new.`,
        `Show genuine curiosity about their life in ${targetUser.location_region}.`
      ],
      avoidList: dealbreakers.map(d => `Be mindful of their dealbreaker: ${d.replace(/_/g, ' ')}`),
      compatibility: [`Take time to discover your connection naturally.`],
      dealbreakers
    });
  }
});

// API: Generate wingman audio narrative
app.get('/api/wingman/:userId/:targetUserId', async (req, res) => {
  const { userId, targetUserId } = req.params;
  
  const currentUser = profiles.find(p => p.user_id === userId);
  const targetUser = profiles.find(p => p.user_id === targetUserId);
  
  if (!currentUser || !targetUser) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  const yourInterests = currentUser.interests.split(',').map(i => i.trim());
  const theirInterests = targetUser.interests.split(',').map(i => i.trim());
  const sharedInterests = yourInterests.filter(i => theirInterests.includes(i));
  
  // Generate wingman narrative using LLM
  const prompt = `You are a supportive wingman helping someone talk to their date. Generate a short, encouraging pep talk (max 4-5 sentences) that they can listen to before approaching their match.

YOUR FRIEND:
- Name: ${currentUser.name}
- Age: ${currentUser.age}
- Interests: ${currentUser.interests}

THEIR DATE:
- Name: ${targetUser.name}
- Age: ${targetUser.age}
- Location: ${targetUser.location_region}
- Interests: ${targetUser.interests}

Shared interests: ${sharedInterests.length > 0 ? sharedInterests.join(', ') : 'None yet'}

Generate an encouraging, natural-sounding pep talk. Address ${currentUser.name} directly. Be warm, confident, and specific about conversation starters based on ${targetUser.name}'s interests. Keep it brief and conversational - like a friend hyping them up. Don't use bullet points or lists, just flowing speech.`;

  try {
    // Get narrative from LLM
    const llmResponse = await fetch(AZURE_OPENAI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': AZURE_OPENAI_API_KEY
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'You are a supportive, encouraging wingman. Speak naturally and warmly.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.8,
        max_tokens: 300
      })
    });

    if (!llmResponse.ok) {
      throw new Error(`LLM API error: ${llmResponse.status}`);
    }

    const llmData = await llmResponse.json();
    const narrative = llmData.choices[0].message.content.trim();
    
    // Convert to speech using Azure TTS
    const ssml = `
      <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">
        <voice name="en-US-GuyNeural">
          <prosody rate="0%" pitch="0%">
            ${narrative.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}
          </prosody>
        </voice>
      </speak>
    `;

    const ttsResponse = await fetch(AZURE_SPEECH_TTS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': AZURE_SPEECH_API_KEY,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3'
      },
      body: ssml
    });

    if (!ttsResponse.ok) {
      const errorText = await ttsResponse.text();
      console.error('TTS error:', errorText);
      throw new Error(`TTS API error: ${ttsResponse.status}`);
    }

    const audioBuffer = await ttsResponse.arrayBuffer();
    
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.byteLength
    });
    res.send(Buffer.from(audioBuffer));
    
  } catch (error) {
    console.error('Error generating wingman audio:', error);
    res.status(500).json({ error: 'Failed to generate wingman audio' });
  }
});

// API: Transcribe audio feedback and store
app.post('/api/feedback/:userId/:targetUserId', express.raw({ type: 'audio/*', limit: '10mb' }), async (req, res) => {
  const { userId, targetUserId } = req.params;
  
  if (!req.body || req.body.length === 0) {
    return res.status(400).json({ error: 'No audio data received' });
  }

  try {
    // Transcribe audio using Azure Speech-to-Text
    const sttResponse = await fetch(AZURE_SPEECH_STT_ENDPOINT, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': AZURE_SPEECH_API_KEY,
        'Content-Type': 'audio/wav'
      },
      body: req.body
    });

    if (!sttResponse.ok) {
      const errorText = await sttResponse.text();
      console.error('STT error:', errorText);
      throw new Error(`STT API error: ${sttResponse.status}`);
    }

    const sttData = await sttResponse.json();
    const transcript = sttData.DisplayText || sttData.NBest?.[0]?.Display || '';
    
    if (!transcript) {
      return res.status(400).json({ error: 'Could not transcribe audio' });
    }

    // Store feedback in database
    db.run(`
      INSERT INTO feedback (user_id, target_user_id, transcript, created_at)
      VALUES (?, ?, ?, datetime('now'))
    `, [userId, targetUserId, transcript]);
    saveDatabase();

    res.json({ success: true, transcript });
  } catch (error) {
    console.error('Error processing feedback:', error);
    res.status(500).json({ error: 'Failed to process feedback' });
  }
});

// API: Get all feedback for a target user
app.get('/api/feedback/:userId/:targetUserId', (req, res) => {
  const { userId, targetUserId } = req.params;
  
  const stmt = db.prepare(`
    SELECT transcript, created_at FROM feedback 
    WHERE user_id = ? AND target_user_id = ?
    ORDER BY created_at DESC
  `);
  stmt.bind([userId, targetUserId]);
  
  const feedbacks = [];
  while (stmt.step()) {
    feedbacks.push(stmt.getAsObject());
  }
  stmt.free();
  
  res.json(feedbacks);
});

// API: Get feedback summary using LLM
app.get('/api/feedback-summary/:userId/:targetUserId', async (req, res) => {
  const { userId, targetUserId } = req.params;
  
  const currentUser = profiles.find(p => p.user_id === userId);
  const targetUser = profiles.find(p => p.user_id === targetUserId);
  
  if (!targetUser) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  // Get all feedback
  const stmt = db.prepare(`
    SELECT transcript, created_at FROM feedback 
    WHERE user_id = ? AND target_user_id = ?
    ORDER BY created_at ASC
  `);
  stmt.bind([userId, targetUserId]);
  
  const feedbacks = [];
  while (stmt.step()) {
    feedbacks.push(stmt.getAsObject());
  }
  stmt.free();
  
  if (feedbacks.length === 0) {
    return res.json({ 
      targetName: targetUser.name,
      summary: 'No feedback recorded yet. Use the feedback button to record your thoughts after interacting with this person.'
    });
  }

  const feedbackText = feedbacks.map((f, i) => `Entry ${i + 1}: "${f.transcript}"`).join('\n');
  
  const prompt = `You are helping someone reflect on their dating experiences. Below are their recorded feedback entries about interactions with ${targetUser.name}.

FEEDBACK ENTRIES:
${feedbackText}

Provide a helpful summary that:
1. Identifies patterns in their experiences (positive and negative)
2. Notes any concerns or red flags they mentioned
3. Highlights positive moments they enjoyed
4. Gives a brief overall assessment of how things are going

Keep it concise (3-4 sentences max), warm, and constructive. If there are concerns, address them honestly but kindly.`;

  try {
    const response = await fetch(AZURE_OPENAI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': AZURE_OPENAI_API_KEY
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'You are a supportive dating coach helping someone reflect on their experiences.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 300
      })
    });

    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status}`);
    }

    const data = await response.json();
    const summary = data.choices[0].message.content.trim();

    res.json({
      targetName: targetUser.name,
      feedbackCount: feedbacks.length,
      summary
    });
  } catch (error) {
    console.error('Error generating summary:', error);
    res.json({
      targetName: targetUser.name,
      feedbackCount: feedbacks.length,
      summary: `You have ${feedbacks.length} feedback entries recorded. Unable to generate AI summary at this time.`
    });
  }
});

// API: Get dating dashboard with KPIs
app.get('/api/dashboard/:userId/:targetUserId', async (req, res) => {
  const { userId, targetUserId } = req.params;
  
  const currentUser = profiles.find(p => p.user_id === userId);
  const targetUser = profiles.find(p => p.user_id === targetUserId);
  
  if (!currentUser || !targetUser) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  // Calculate matching score based on personality traits and interests
  const yourInterests = currentUser.interests.split(',').map(i => i.trim());
  const theirInterests = targetUser.interests.split(',').map(i => i.trim());
  const sharedInterests = yourInterests.filter(i => theirInterests.includes(i));
  const interestScore = Math.min((sharedInterests.length / Math.max(yourInterests.length, 1)) * 100, 100);
  
  // Personality compatibility (inverse of differences)
  const traits = ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'];
  let personalityScore = 0;
  traits.forEach(trait => {
    const diff = Math.abs(parseFloat(currentUser[trait]) - parseFloat(targetUser[trait]));
    personalityScore += (1 - diff) * 20; // Each trait worth 20 points
  });
  
  // Age compatibility
  const yourAge = parseInt(currentUser.age);
  const theirAge = parseInt(targetUser.age);
  const theirPrefMin = parseInt(targetUser.pref_age_min);
  const theirPrefMax = parseInt(targetUser.pref_age_max);
  const ageCompatible = yourAge >= theirPrefMin && yourAge <= theirPrefMax;
  const ageScore = ageCompatible ? 100 : Math.max(0, 100 - Math.abs(yourAge - (theirPrefMin + theirPrefMax) / 2) * 5);
  
  // Overall matching score (weighted average)
  const matchingScore = Math.round((interestScore * 0.3) + (personalityScore * 0.5) + (ageScore * 0.2));
  
  // Get feedback for sentiment KPI
  const stmt = db.prepare(`
    SELECT transcript, created_at FROM feedback 
    WHERE user_id = ? AND target_user_id = ?
    ORDER BY created_at ASC
  `);
  stmt.bind([userId, targetUserId]);
  
  const feedbacks = [];
  while (stmt.step()) {
    feedbacks.push(stmt.getAsObject());
  }
  stmt.free();
  
  // If no feedback, return basic stats
  if (feedbacks.length === 0) {
    return res.json({
      targetName: targetUser.name,
      matchingScore,
      interestScore: Math.round(interestScore),
      personalityScore: Math.round(personalityScore),
      ageScore: Math.round(ageScore),
      sharedInterests,
      feedbackKPI: null,
      feedbackCount: 0,
      recommendation: 'Not enough data yet - record some feedback after your interactions!',
      shouldContinue: null,
      redFlags: [],
      greenFlags: []
    });
  }

  const feedbackText = feedbacks.map((f, i) => `Entry ${i + 1}: "${f.transcript}"`).join('\n');
  
  const prompt = `You are a dating analytics AI. Analyze the following feedback entries about interactions with ${targetUser.name} and provide a data-driven assessment.

FEEDBACK ENTRIES:
${feedbackText}

Provide analysis in this exact JSON format:
{
  "sentimentScore": <number 0-100, where 0 is very negative, 50 is neutral, 100 is very positive>,
  "engagementTrend": "<improving/declining/stable>",
  "redFlags": ["<concerning pattern 1>", "<concerning pattern 2>"],
  "greenFlags": ["<positive pattern 1>", "<positive pattern 2>"],
  "shouldContinue": <true/false>,
  "recommendation": "<2-3 sentence recommendation on whether to continue pursuing this relationship or gracefully exit>"
}

Be honest and analytical. If there are serious concerns, recommend abandoning. If things are going well, encourage continuation.`;

  try {
    const response = await fetch(AZURE_OPENAI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': AZURE_OPENAI_API_KEY
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'You are a dating analytics AI. Always respond with valid JSON only.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.5,
        max_tokens: 400
      })
    });

    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    
    let analysis;
    try {
      const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      analysis = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error('Failed to parse LLM response:', content);
      throw new Error('Failed to parse analysis');
    }

    res.json({
      targetName: targetUser.name,
      matchingScore,
      interestScore: Math.round(interestScore),
      personalityScore: Math.round(personalityScore),
      ageScore: Math.round(ageScore),
      sharedInterests,
      feedbackKPI: analysis.sentimentScore,
      engagementTrend: analysis.engagementTrend,
      feedbackCount: feedbacks.length,
      recommendation: analysis.recommendation,
      shouldContinue: analysis.shouldContinue,
      redFlags: analysis.redFlags || [],
      greenFlags: analysis.greenFlags || []
    });
  } catch (error) {
    console.error('Error generating dashboard:', error);
    res.json({
      targetName: targetUser.name,
      matchingScore,
      interestScore: Math.round(interestScore),
      personalityScore: Math.round(personalityScore),
      ageScore: Math.round(ageScore),
      sharedInterests,
      feedbackKPI: null,
      feedbackCount: feedbacks.length,
      recommendation: 'Unable to analyze feedback at this time.',
      shouldContinue: null,
      redFlags: [],
      greenFlags: []
    });
  }
});

// Start server
async function start() {
  await initDatabase();
  app.listen(PORT, () => {
    console.log(`Cupid Swipe app running at http://localhost:${PORT}`);
  });
}

start();
