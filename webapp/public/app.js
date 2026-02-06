// State
let currentUser = null;
let profiles = [];
let currentIndex = 0;

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const swipeScreen = document.getElementById('swipe-screen');
const likesScreen = document.getElementById('likes-screen');
const nameInput = document.getElementById('name-input');
const loginBtn = document.getElementById('login-btn');
const loginError = document.getElementById('login-error');
const currentUserName = document.getElementById('current-user-name');
const cardStack = document.getElementById('card-stack');
const noMoreCards = document.getElementById('no-more-cards');
const swipeLeftBtn = document.getElementById('swipe-left-btn');
const swipeRightBtn = document.getElementById('swipe-right-btn');
const viewLikesBtn = document.getElementById('view-likes-btn');
const viewLikesBtn2 = document.getElementById('view-likes-btn-2');
const backBtn = document.getElementById('back-btn');
const logoutBtn = document.getElementById('logout-btn');
const likesGrid = document.getElementById('likes-grid');

// Login
loginBtn.addEventListener('click', login);
nameInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') login();
});

async function login() {
  const name = nameInput.value.trim();
  if (!name) {
    loginError.textContent = 'Please enter your name';
    return;
  }

  // Easter egg for Fabian - block login and show banner
  const fabianBanner = document.getElementById('fabian-banner');
  if (name.toLowerCase().includes('fabian')) {
    fabianBanner.classList.remove('hidden');
    loginError.textContent = '';
    return; // Don't proceed with login
  } else {
    fabianBanner.classList.add('hidden');
  }

  try {
    const res = await fetch(`/api/login/${encodeURIComponent(name)}`);
    const data = await res.json();

    if (data.success) {
      currentUser = data.user;
      currentUserName.textContent = currentUser.name;
      loginScreen.classList.add('hidden');
      swipeScreen.classList.remove('hidden');
      loadProfiles();
    } else {
      loginError.textContent = 'User not found. Try another name.';
    }
  } catch (error) {
    loginError.textContent = 'Error connecting to server';
  }
}

// Load profiles
async function loadProfiles() {
  try {
    const res = await fetch(`/api/profiles/${currentUser.user_id}`);
    profiles = await res.json();
    currentIndex = 0;
    renderCards();
  } catch (error) {
    console.error('Error loading profiles:', error);
  }
}

// Render cards
function renderCards() {
  cardStack.innerHTML = '';
  
  if (currentIndex >= profiles.length) {
    noMoreCards.classList.remove('hidden');
    return;
  }

  noMoreCards.classList.add('hidden');

  // Render next 3 cards (for stack effect)
  const cardsToRender = profiles.slice(currentIndex, currentIndex + 3).reverse();
  
  cardsToRender.forEach((profile, idx) => {
    const card = createCard(profile, idx === cardsToRender.length - 1);
    cardStack.appendChild(card);
  });
}

function createCard(profile, isTop) {
  const card = document.createElement('div');
  card.className = 'profile-card';
  card.dataset.userId = profile.user_id;

  const interests = profile.interests.split(',').slice(0, 4);

  card.innerHTML = `
    <div class="swipe-overlay like">LIKE</div>
    <div class="swipe-overlay nope">NOPE</div>
    <div class="photo">
      <img src="/pictures/${profile.user_id}.jpg" 
           onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"
           alt="${profile.name}">
      <div class="placeholder" style="display:none;">👤</div>
    </div>
    <div class="info">
      <h3>${profile.name}</h3>
      <p class="age-location">${profile.age} • ${profile.location_region}</p>
      <div class="interests">
        ${interests.map(i => `<span class="interest-tag">${i.trim()}</span>`).join('')}
      </div>
    </div>
  `;

  if (isTop) {
    enableSwipe(card);
  }

  return card;
}

// Swipe functionality
let startX = 0;
let currentX = 0;
let isDragging = false;

function enableSwipe(card) {
  card.addEventListener('mousedown', onDragStart);
  card.addEventListener('touchstart', onDragStart, { passive: false });
  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('touchmove', onDragMove, { passive: false });
  document.addEventListener('mouseup', onDragEnd);
  document.addEventListener('touchend', onDragEnd);
}

function onDragStart(e) {
  if (e.target.closest('.profile-card') !== cardStack.lastElementChild) return;
  isDragging = true;
  startX = e.type === 'mousedown' ? e.clientX : e.touches[0].clientX;
  cardStack.lastElementChild.style.transition = 'none';
  // Prevent browser back/forward navigation on swipe
  if (e.type === 'touchstart') {
    e.preventDefault();
  }
}

function onDragMove(e) {
  if (!isDragging) return;
  e.preventDefault();
  
  const clientX = e.type === 'mousemove' ? e.clientX : e.touches[0].clientX;
  currentX = clientX - startX;
  
  const card = cardStack.lastElementChild;
  const rotation = currentX * 0.1;
  card.style.transform = `translateX(${currentX}px) rotate(${rotation}deg)`;

  // Show overlays
  const likeOverlay = card.querySelector('.swipe-overlay.like');
  const nopeOverlay = card.querySelector('.swipe-overlay.nope');
  
  if (currentX > 50) {
    likeOverlay.style.opacity = Math.min((currentX - 50) / 100, 1);
    nopeOverlay.style.opacity = 0;
  } else if (currentX < -50) {
    nopeOverlay.style.opacity = Math.min((-currentX - 50) / 100, 1);
    likeOverlay.style.opacity = 0;
  } else {
    likeOverlay.style.opacity = 0;
    nopeOverlay.style.opacity = 0;
  }
}

function onDragEnd() {
  if (!isDragging) return;
  isDragging = false;

  const card = cardStack.lastElementChild;
  if (!card) return;

  card.style.transition = 'transform 0.3s ease';

  if (currentX > 100) {
    swipe('right');
  } else if (currentX < -100) {
    swipe('left');
  } else {
    // Reset position
    card.style.transform = '';
    card.querySelector('.swipe-overlay.like').style.opacity = 0;
    card.querySelector('.swipe-overlay.nope').style.opacity = 0;
  }

  currentX = 0;
}

async function swipe(direction) {
  const card = cardStack.lastElementChild;
  if (!card) return;

  const userId = card.dataset.userId;
  card.classList.add('swiping');

  // Animate out
  const translateX = direction === 'right' ? 500 : -500;
  card.style.transform = `translateX(${translateX}px) rotate(${direction === 'right' ? 30 : -30}deg)`;
  card.style.opacity = '0';

  // Save swipe to server
  try {
    await fetch('/api/swipe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: currentUser.user_id,
        swipedUserId: userId,
        direction: direction
      })
    });
  } catch (error) {
    console.error('Error saving swipe:', error);
  }

  // Move to next card
  setTimeout(() => {
    currentIndex++;
    renderCards();
  }, 300);
}

// Button swipes
swipeLeftBtn.addEventListener('click', () => swipe('left'));
swipeRightBtn.addEventListener('click', () => swipe('right'));

// View likes
viewLikesBtn.addEventListener('click', showLikes);
viewLikesBtn2.addEventListener('click', showLikes);

async function showLikes() {
  try {
    const res = await fetch(`/api/likes/${currentUser.user_id}`);
    const likes = await res.json();

    likesGrid.innerHTML = '';
    
    if (likes.length === 0) {
      likesGrid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #666;">No likes yet. Keep swiping!</p>';
    } else {
      likes.forEach(profile => {
        const card = document.createElement('div');
        card.className = 'like-card';
        card.dataset.userId = profile.user_id;
        
        // Calculate days since last contact for promising matches
        let contactBadge = '';
        if (profile.isPromising && profile.lastFeedbackDate) {
          const lastDate = new Date(profile.lastFeedbackDate);
          const now = new Date();
          const daysSince = Math.floor((now - lastDate) / (1000 * 60 * 60 * 24));
          let badgeClass = 'contact-badge';
          let badgeText = '';
          if (daysSince === 0) { badgeClass += ' today'; badgeText = 'Today'; }
          else if (daysSince <= 3) { badgeClass += ' recent'; badgeText = daysSince + 'd'; }
          else if (daysSince <= 7) { badgeClass += ' warning'; badgeText = daysSince + 'd !'; }
          else { badgeClass += ' urgent'; badgeText = daysSince + 'd !!'; }
          contactBadge = '<div class="' + badgeClass + '">' + badgeText + '</div>';
        } else if (profile.isPromising && !profile.lastFeedbackDate) {
          contactBadge = '<div class="contact-badge no-contact">No contact!</div>';
        }
        const promisingIcon = profile.isPromising ? ' *' : '';
        card.innerHTML = contactBadge + `
          <div class="photo">
            <img src="/pictures/${profile.user_id}.jpg" 
                 onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"
                 alt="${profile.name}">
            <div class="placeholder" style="display:none;">👤</div>
          </div>
          <div class="info">
            <h4>${profile.name}${promisingIcon}</h4>
            <p>${profile.age} • ${profile.location_region}</p>
            <div class="like-card-buttons">
              <button class="delete-like-btn" data-user-id="${profile.user_id}">✕ Remove</button>
              <button class="advice-btn" data-user-id="${profile.user_id}">💘 Aim for the Heart</button>
              <button class="wingman-btn" data-user-id="${profile.user_id}">🎤 Wingman</button>
              <button class="feedback-btn" data-user-id="${profile.user_id}">🎙️ Feedback</button>
              <button class="summary-btn" data-user-id="${profile.user_id}">📝 Summary</button>
              <button class="dashboard-btn" data-user-id="${profile.user_id}">📊 Dashboard</button>
            </div>
          </div>
        `;
        likesGrid.appendChild(card);
      });

      // Add delete handlers
      document.querySelectorAll('.delete-like-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const swipedUserId = btn.dataset.userId;
          await deleteLike(swipedUserId);
        });
      });

      // Add advice handlers
      document.querySelectorAll('.advice-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const targetUserId = btn.dataset.userId;
          await showAdvice(targetUserId);
        });
      });

      // Add wingman handlers
      document.querySelectorAll('.wingman-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const targetUserId = btn.dataset.userId;
          await playWingman(targetUserId, btn);
        });
      });

      // Add feedback handlers
      document.querySelectorAll('.feedback-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const targetUserId = btn.dataset.userId;
          await recordFeedback(targetUserId, btn);
        });
      });

      // Add summary handlers
      document.querySelectorAll('.summary-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const targetUserId = btn.dataset.userId;
          await showFeedbackSummary(targetUserId);
        });
      });

      // Add dashboard handlers
      document.querySelectorAll('.dashboard-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const targetUserId = btn.dataset.userId;
          await showDashboard(targetUserId);
        });
      });
    }

    swipeScreen.classList.add('hidden');
    likesScreen.classList.remove('hidden');
  } catch (error) {
    console.error('Error loading likes:', error);
  }
}

// Show dating advice modal
async function showAdvice(targetUserId) {
  // Show loading state
  const modal = document.getElementById('advice-modal');
  const recommendationBanner = document.getElementById('recommendation-banner');
  recommendationBanner.className = 'recommendation-banner';
  recommendationBanner.textContent = '';
  document.getElementById('advice-target-name').textContent = 'Loading...';
  document.getElementById('advice-target-info').textContent = 'Generating personalized advice...';
  document.getElementById('general-advice-text').textContent = 'Please wait...';
  document.getElementById('talking-points-list').innerHTML = '<li>Analyzing profiles...</li>';
  document.getElementById('avoid-list').innerHTML = '';
  document.getElementById('compatibility-list').innerHTML = '';
  document.getElementById('shared-interests-tags').innerHTML = '';
  modal.classList.remove('hidden');

  try {
    const res = await fetch(`/api/advice/${currentUser.user_id}/${targetUserId}`);
    const advice = await res.json();

    // Populate modal
    document.getElementById('advice-target-name').textContent = advice.targetName;
    document.getElementById('advice-target-info').textContent = `${advice.targetAge} years old • ${advice.targetRegion}`;

    // Recommendation banner
    if (advice.recommendDate) {
      recommendationBanner.className = 'recommendation-banner go-for-it';
      recommendationBanner.textContent = '✓ Go for it! No obvious compatibility issues detected.';
    } else {
      recommendationBanner.className = 'recommendation-banner think-twice';
      recommendationBanner.textContent = '⚠ Think twice - there may be compatibility concerns.';
    }

    // General advice
    document.getElementById('general-advice-text').textContent = advice.generalAdvice || 'No general advice available.';

    // Talking points
    const talkingPointsList = document.getElementById('talking-points-list');
    talkingPointsList.innerHTML = advice.talkingPoints.map(point => `<li>${point}</li>`).join('');

    // What to avoid
    const avoidList = document.getElementById('avoid-list');
    avoidList.innerHTML = advice.avoidList.map(item => `<li>${item}</li>`).join('');

    // Compatibility
    const compatibilityList = document.getElementById('compatibility-list');
    if (advice.compatibility.length > 0) {
      compatibilityList.innerHTML = advice.compatibility.map(item => `<li>${item}</li>`).join('');
    } else {
      compatibilityList.innerHTML = '<li>Be yourself and let the connection develop naturally!</li>';
    }

    // Shared interests
    const sharedInterestsTags = document.getElementById('shared-interests-tags');
    if (advice.sharedInterests.length > 0) {
      sharedInterestsTags.innerHTML = advice.sharedInterests.map(i => `<span class="interest-tag">${i}</span>`).join('');
    } else {
      sharedInterestsTags.innerHTML = '<span class="no-shared">No shared interests yet - a chance to learn something new!</span>';
    }
  } catch (error) {
    console.error('Error loading advice:', error);
    document.getElementById('advice-target-name').textContent = 'Error';
    document.getElementById('advice-target-info').textContent = 'Failed to load advice. Please try again.';
    recommendationBanner.className = 'recommendation-banner';
    recommendationBanner.textContent = '';
    document.getElementById('general-advice-text').textContent = '';
  }
}

// Close modal
document.getElementById('close-modal-btn').addEventListener('click', () => {
  document.getElementById('advice-modal').classList.add('hidden');
});

// Close modal on background click
document.getElementById('advice-modal').addEventListener('click', (e) => {
  if (e.target.id === 'advice-modal') {
    document.getElementById('advice-modal').classList.add('hidden');
  }
});

// Close feedback modal
document.getElementById('close-feedback-modal-btn').addEventListener('click', () => {
  document.getElementById('feedback-modal').classList.add('hidden');
});

document.getElementById('feedback-modal').addEventListener('click', (e) => {
  if (e.target.id === 'feedback-modal') {
    document.getElementById('feedback-modal').classList.add('hidden');
  }
});

// Close dashboard modal
document.getElementById('close-dashboard-modal-btn').addEventListener('click', () => {
  document.getElementById('dashboard-modal').classList.add('hidden');
});

document.getElementById('dashboard-modal').addEventListener('click', (e) => {
  if (e.target.id === 'dashboard-modal') {
    document.getElementById('dashboard-modal').classList.add('hidden');
  }
});

// Show dating dashboard
let currentDashboardTarget = null;

async function showDashboard(targetUserId) {
  currentDashboardTarget = targetUserId;
  const modal = document.getElementById('dashboard-modal');
  const verdict = document.getElementById('dashboard-verdict');
  document.getElementById('dashboard-target-name').textContent = 'Loading...';
  document.getElementById('kpi-matching').textContent = '--';
  document.getElementById('kpi-feedback').textContent = '--';
  document.getElementById('kpi-trend').textContent = '--';
  document.getElementById('dashboard-recommendation').textContent = 'Analyzing...';
  document.getElementById('dashboard-recommendation').className = 'dashboard-recommendation';
  verdict.classList.add('hidden');
  verdict.className = 'dashboard-verdict hidden';
  document.getElementById('red-flags-list').innerHTML = '';
  document.getElementById('green-flags-list').innerHTML = '';
  modal.classList.remove('hidden');

  try {
    const res = await fetch(`/api/dashboard/${currentUser.user_id}/${targetUserId}`);
    const data = await res.json();

    document.getElementById('dashboard-target-name').textContent = data.targetName;
    
    // KPI cards
    document.getElementById('kpi-matching').textContent = data.matchingScore + '%';
    document.getElementById('kpi-feedback').textContent = data.feedbackKPI !== null ? data.feedbackKPI + '%' : 'N/A';
    
    const trendEmoji = data.engagementTrend === 'improving' ? '↗️' : 
                       data.engagementTrend === 'declining' ? '↘️' : '↔️';
    document.getElementById('kpi-trend').textContent = data.engagementTrend ? 
      trendEmoji + ' ' + data.engagementTrend.charAt(0).toUpperCase() + data.engagementTrend.slice(1) : 'N/A';
    
    // Score breakdown bars
    document.getElementById('bar-interests').style.width = data.interestScore + '%';
    document.getElementById('score-interests').textContent = data.interestScore + '%';
    document.getElementById('bar-personality').style.width = data.personalityScore + '%';
    document.getElementById('score-personality').textContent = data.personalityScore + '%';
    document.getElementById('bar-age').style.width = data.ageScore + '%';
    document.getElementById('score-age').textContent = data.ageScore + '%';
    
    // Prominent verdict banner
    if (data.shouldContinue === true) {
      verdict.className = 'dashboard-verdict continue';
      document.getElementById('verdict-icon').textContent = '💚';
      document.getElementById('verdict-text').textContent = 'KEEP GOING! This match shows promise.';
      verdict.classList.remove('hidden');
    } else if (data.shouldContinue === false) {
      verdict.className = 'dashboard-verdict abandon';
      document.getElementById('verdict-icon').textContent = '🚫';
      document.getElementById('verdict-text').textContent = 'CONSIDER MOVING ON. The signs suggest this may not work out.';
      verdict.classList.remove('hidden');
    }
    
    // Recommendation with styling
    const recEl = document.getElementById('dashboard-recommendation');
    recEl.textContent = data.recommendation;
    if (data.shouldContinue === true) {
      recEl.className = 'dashboard-recommendation continue';
    } else if (data.shouldContinue === false) {
      recEl.className = 'dashboard-recommendation abandon';
    } else {
      recEl.className = 'dashboard-recommendation';
    }
    
    // Flags
    const redFlagsList = document.getElementById('red-flags-list');
    if (data.redFlags.length > 0) {
      redFlagsList.innerHTML = data.redFlags.map(f => `<li>${f}</li>`).join('');
    } else {
      redFlagsList.innerHTML = '<li class="no-flags">None detected</li>';
    }
    
    const greenFlagsList = document.getElementById('green-flags-list');
    if (data.greenFlags.length > 0) {
      greenFlagsList.innerHTML = data.greenFlags.map(f => `<li>${f}</li>`).join('');
    } else {
      greenFlagsList.innerHTML = '<li class="no-flags">Record feedback to see patterns</li>';
    }
  } catch (error) {
    console.error('Error loading dashboard:', error);
    document.getElementById('dashboard-target-name').textContent = 'Error';
    document.getElementById('dashboard-recommendation').textContent = 'Failed to load dashboard. Please try again.';
  }
}

// Dashboard action buttons
document.getElementById('dashboard-remove-btn').addEventListener('click', async () => {
  if (!currentDashboardTarget) return;
  
  if (!confirm('Are you sure you want to remove all data for this match? This cannot be undone.')) {
    return;
  }
  
  try {
    const res = await fetch(`/api/match/${currentUser.user_id}/${currentDashboardTarget}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    
    if (data.success) {
      document.getElementById('dashboard-modal').classList.add('hidden');
      // Refresh likes list
      showLikes();
    }
  } catch (error) {
    console.error('Error removing match:', error);
    alert('Failed to remove data. Please try again.');
  }
});

// Play wingman audio narrative
let currentAudio = null;
let mediaRecorder = null;
let audioChunks = [];

// Record feedback
async function recordFeedback(targetUserId, button) {
  // If already recording, stop
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    audioChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      audioChunks.push(e.data);
    };

    mediaRecorder.onstart = () => {
      button.textContent = '⏹️ Stop';
      button.classList.add('recording');
    };

    mediaRecorder.onstop = async () => {
      button.textContent = '⏳ Processing...';
      button.classList.remove('recording');
      button.disabled = true;

      // Stop all tracks
      stream.getTracks().forEach(track => track.stop());

      // Convert to WAV for Azure Speech API
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      const wavBlob = await convertToWav(audioBlob);

      try {
        const res = await fetch(`/api/feedback/${currentUser.user_id}/${targetUserId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'audio/wav' },
          body: wavBlob
        });

        const data = await res.json();
        
        if (data.success) {
          button.textContent = '✓ Saved!';
          setTimeout(() => {
            button.textContent = '🎙️ Feedback';
            button.disabled = false;
          }, 2000);
        } else {
          throw new Error(data.error || 'Failed to save');
        }
      } catch (error) {
        console.error('Error saving feedback:', error);
        button.textContent = '❌ Error';
        setTimeout(() => {
          button.textContent = '🎙️ Feedback';
          button.disabled = false;
        }, 2000);
      }
    };

    mediaRecorder.start();
  } catch (error) {
    console.error('Error accessing microphone:', error);
    alert('Could not access microphone. Please grant permission.');
  }
}

// Convert webm to wav
async function convertToWav(blob) {
  const audioContext = new AudioContext();
  const arrayBuffer = await blob.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  
  const numChannels = 1;
  const sampleRate = 16000;
  const bitsPerSample = 16;
  
  // Resample to 16kHz
  const offlineContext = new OfflineAudioContext(numChannels, audioBuffer.duration * sampleRate, sampleRate);
  const source = offlineContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineContext.destination);
  source.start();
  const resampledBuffer = await offlineContext.startRendering();
  
  const samples = resampledBuffer.getChannelData(0);
  const dataLength = samples.length * (bitsPerSample / 8);
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);
  
  // WAV header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true);
  view.setUint16(32, numChannels * (bitsPerSample / 8), true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);
  
  // Convert samples to 16-bit PCM
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    offset += 2;
  }
  
  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

// Show feedback summary
async function showFeedbackSummary(targetUserId) {
  const modal = document.getElementById('feedback-modal');
  document.getElementById('feedback-target-name').textContent = 'Loading...';
  document.getElementById('feedback-count').textContent = '';
  document.getElementById('feedback-summary-text').textContent = 'Generating summary...';
  modal.classList.remove('hidden');

  try {
    const res = await fetch(`/api/feedback-summary/${currentUser.user_id}/${targetUserId}`);
    const data = await res.json();

    document.getElementById('feedback-target-name').textContent = `Feedback on ${data.targetName}`;
    document.getElementById('feedback-count').textContent = data.feedbackCount ? `${data.feedbackCount} entries recorded` : '';
    document.getElementById('feedback-summary-text').textContent = data.summary;
  } catch (error) {
    console.error('Error loading summary:', error);
    document.getElementById('feedback-target-name').textContent = 'Error';
    document.getElementById('feedback-summary-text').textContent = 'Failed to load summary. Please try again.';
  }
}

async function playWingman(targetUserId, button) {
  // If audio is playing, stop it
  if (currentAudio && !currentAudio.paused) {
    currentAudio.pause();
    currentAudio = null;
    button.textContent = '🎤 Wingman';
    button.classList.remove('playing');
    return;
  }

  const originalText = button.textContent;
  button.textContent = '⏳ Loading...';
  button.disabled = true;

  try {
    const res = await fetch(`/api/wingman/${currentUser.user_id}/${targetUserId}`);
    
    if (!res.ok) {
      throw new Error('Failed to generate audio');
    }

    const audioBlob = await res.blob();
    const audioUrl = URL.createObjectURL(audioBlob);
    
    currentAudio = new Audio(audioUrl);
    currentAudio.play();
    
    button.textContent = '⏹ Stop';
    button.classList.add('playing');
    button.disabled = false;

    currentAudio.onended = () => {
      button.textContent = '🎤 Wingman';
      button.classList.remove('playing');
      URL.revokeObjectURL(audioUrl);
      currentAudio = null;
    };

    currentAudio.onerror = () => {
      button.textContent = '🎤 Wingman';
      button.classList.remove('playing');
      URL.revokeObjectURL(audioUrl);
      currentAudio = null;
    };
  } catch (error) {
    console.error('Error playing wingman audio:', error);
    button.textContent = originalText;
    button.disabled = false;
    alert('Failed to generate wingman audio. Please try again.');
  }
}

async function deleteLike(swipedUserId) {
  try {
    const res = await fetch(`/api/likes/${currentUser.user_id}/${swipedUserId}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    
    if (data.success) {
      // Remove the card from UI with animation
      const card = document.querySelector(`.like-card[data-user-id="${swipedUserId}"]`);
      if (card) {
        card.style.transition = 'opacity 0.3s, transform 0.3s';
        card.style.opacity = '0';
        card.style.transform = 'scale(0.8)';
        setTimeout(() => {
          card.remove();
          // Check if no more likes
          if (likesGrid.querySelectorAll('.like-card').length === 0) {
            likesGrid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #666;">No likes yet. Keep swiping!</p>';
          }
        }, 300);
      }
    }
  } catch (error) {
    console.error('Error deleting like:', error);
  }
}

// Back button
backBtn.addEventListener('click', () => {
  likesScreen.classList.add('hidden');
  swipeScreen.classList.remove('hidden');
});

// Logout
logoutBtn.addEventListener('click', () => {
  currentUser = null;
  profiles = [];
  currentIndex = 0;
  nameInput.value = '';
  loginError.textContent = '';
  document.getElementById('fabian-banner').classList.add('hidden');
  swipeScreen.classList.add('hidden');
  likesScreen.classList.add('hidden');
  loginScreen.classList.remove('hidden');
});
