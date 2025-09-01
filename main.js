const roomCreationDiv = document.getElementById('room-creation');
const lobbyDiv = document.getElementById('lobby');
const gameAreaDiv = document.getElementById('game-area');
const createRoomBtn = document.getElementById('create-room-btn');
const joinRoomBtn = document.getElementById('join-room-btn');
const playerNameInput = document.getElementById('player-name-input');
const joinRoomInput = document.getElementById('join-room-input');
const lobbyRoomId = document.getElementById('lobby-room-id');
const lobbyPlayerList = document.getElementById('lobby-player-list');
const startGameBtn = document.getElementById('start-game-btn');
const playerHandsContainer = document.getElementById('player-hands');
const loreLordControlsContainer = document.getElementById('lore-lord-controls');
const scoresContainer = document.getElementById('scores');

let peer;
const connections = {};
let isHost = false;
let myPeerId;

const gameState = {
    players: {},
    prompt: '',
    propCards: {},
    revealedProps: {},
    storyStatus: {},
    loreLord: null,
    scores: {},
    gameStarted: false,
    roundInProgress: false,
    activeStoryteller: null,
    storiesTold: 0,
    winner: null,
};

class PromptCard extends HTMLElement {
    constructor() {
        super();
        const template = document.getElementById('prompt-card-template').content;
        this.attachShadow({ mode: 'open' }).appendChild(template.cloneNode(true));
        this.promptTextElement = this.shadowRoot.querySelector('.prompt-text');
    }
    set prompt(text) { this.promptTextElement.textContent = text; }
}
customElements.define('prompt-card', PromptCard);

class PlayerHand extends HTMLElement {
    constructor() {
        super();
        const template = document.getElementById('player-hand-template').content;
        this.attachShadow({ mode: 'open' }).appendChild(template.cloneNode(true));
        this.playerNameEl = this.shadowRoot.querySelector('.player-name');
        this.propCardsEl = this.shadowRoot.querySelector('.prop-cards-container');
        this.storyStatusEl = this.shadowRoot.querySelector('.story-status');
        this.truthChoiceEl = this.shadowRoot.querySelector('.truth-choice-buttons');
        this.bestStoryBtn = this.shadowRoot.querySelector('.best-story-btn');
        
        this.shadowRoot.querySelector('.true-btn').addEventListener('click', () => this.dispatchEvent(new CustomEvent('set-truth', { detail: { isTrue: true } })));
        this.shadowRoot.querySelector('.fake-btn').addEventListener('click', () => this.dispatchEvent(new CustomEvent('set-truth', { detail: { isTrue: false } })));
        this.bestStoryBtn.addEventListener('click', () => this.dispatchEvent(new CustomEvent('pick-best', { detail: { peerId: this.dataset.peerId } })));
    }

    render(playerData) {
        const { name, isYou, isLoreLord, isStoryteller, propCards, revealedProps, storyStatus } = playerData;
        this.playerNameEl.textContent = `${name}${isYou ? ' (You)' : ''}${isLoreLord ? ' (Lore Lord)' : ''}`;

        this.propCardsEl.innerHTML = '<strong>Prop Cards:</strong>';
        if (propCards) {
            propCards.forEach((card, index) => {
                const cardEl = document.createElement('div');
                cardEl.classList.add('prop-card');
                const cardText = document.createElement('span');
                cardText.classList.add('prop-card-text');

                if (revealedProps && revealedProps[index]) {
                    cardText.textContent = card;
                    cardEl.classList.add('revealed');
                } else {
                    cardText.textContent = isYou || isLoreLord ? card : 'Hidden Prop';
                    if (!isYou) cardText.classList.add('hidden');
                }

                cardEl.appendChild(cardText);

                if (isYou && isStoryteller && !(revealedProps && revealedProps[index])) {
                    const revealBtn = document.createElement('button');
                    revealBtn.textContent = 'Reveal';
                    revealBtn.addEventListener('click', () => this.dispatchEvent(new CustomEvent('reveal-prop', { detail: { index } })));
                    cardEl.appendChild(revealBtn);
                }
                this.propCardsEl.appendChild(cardEl);
            });
        }

        if (isYou && isStoryteller && !storyStatus) {
            this.truthChoiceEl.style.display = 'block';
        } else {
            this.truthChoiceEl.style.display = 'none';
        }

        if (storyStatus) {
            const truthText = storyStatus.isTrue ? 'This story was TRUE' : 'This story was FAKE';
            const points = (storyStatus.isTrue ? 2 : 1) + Object.keys(revealedProps || {}).length;
            this.storyStatusEl.textContent = `Story Status: ${truthText} (${points} points)`;
        } else {
            this.storyStatusEl.textContent = '';
        }

        if (playerData.showBestStoryBtn) {
            this.bestStoryBtn.style.display = 'block';
        } else {
            this.bestStoryBtn.style.display = 'none';
        }
    }
}
customElements.define('player-hand', PlayerHand);

function initializePeer() {
    peer = new Peer();
    peer.on('open', id => { myPeerId = id; });
    peer.on('connection', conn => {
        if (isHost) {
            connections[conn.peer] = conn;
            setupConnectionHandlers(conn);
        }
    });
    peer.on('error', err => { console.error('PeerJS error:', err); alert('An error occurred.'); });
}

function showLobby() {
    roomCreationDiv.style.display = 'none';
    lobbyDiv.style.display = 'block';
    lobbyRoomId.textContent = peer.id;
    renderLobbyPlayers();
}

function showGameArea() {
    lobbyDiv.style.display = 'none';
    gameAreaDiv.style.display = 'block';
}

createRoomBtn.addEventListener('click', () => {
    const name = playerNameInput.value.trim();
    if (!name) return alert('Please enter your name.');
    isHost = true;
    gameState.players[myPeerId] = { name };
    gameState.scores[myPeerId] = 0;
    gameState.loreLord = myPeerId;
    showLobby();
});

startGameBtn.addEventListener('click', () => {
    if (isHost) {
        gameState.gameStarted = true;
        startNewRound();
    }
});

joinRoomBtn.addEventListener('click', () => {
    const name = playerNameInput.value.trim();
    if (!name) return alert('Please enter your name.');
    const roomId = joinRoomInput.value.trim();
    if (roomId) {
        gameState.players[myPeerId] = { name };
        gameState.scores[myPeerId] = 0;
        const conn = peer.connect(roomId);
        connections[roomId] = conn;
        setupConnectionHandlers(conn);
    }
});

function startNewRound() {
    gameState.prompt = prompts[Math.floor(Math.random() * prompts.length)];
    gameState.propCards = {};
    gameState.revealedProps = {};
    gameState.storyStatus = {};
    gameState.storiesTold = 0;
    gameState.winner = null;
    gameState.roundInProgress = true;

    const playerIds = Object.keys(gameState.players);
    const storytellerIds = playerIds.filter(id => id !== gameState.loreLord);

    storytellerIds.forEach(id => {
        gameState.propCards[id] = [props[Math.floor(Math.random() * props.length)], props[Math.floor(Math.random() * props.length)], props[Math.floor(Math.random() * props.length)]];
        gameState.revealedProps[id] = {};
    });

    gameState.activeStoryteller = storytellerIds[0] || null;
    broadcastGameState();
}

function broadcastGameState() {
    if (isHost) {
        Object.values(connections).forEach(conn => conn.send({ type: 'gameState', state: gameState }));
        updateUI();
    }
}

function handleHostAction(peerId, action) {
    const { type, payload } = action;
    switch (type) {
        case 'setTruth':
            gameState.storyStatus[peerId] = { isTrue: payload.isTrue };
            gameState.storiesTold++;
            const storytellerIds = Object.keys(gameState.players).filter(id => id !== gameState.loreLord);
            if (gameState.storiesTold < storytellerIds.length) {
                const currentIndex = storytellerIds.indexOf(peerId);
                gameState.activeStoryteller = storytellerIds[currentIndex + 1];
            } else {
                gameState.activeStoryteller = null; // All stories told, voting phase begins
            }
            break;
        case 'revealProp':
            gameState.revealedProps[peerId][payload.index] = true;
            break;
        case 'pickBestStory':
            const winnerId = payload.peerId;
            const story = gameState.storyStatus[winnerId];
            const revealedCount = Object.keys(gameState.revealedProps[winnerId]).length;
            const score = (story.isTrue ? 2 : 1) + revealedCount;
            gameState.scores[winnerId] += score;
            gameState.winner = winnerId;
            gameState.roundInProgress = false;
            // Rotate lore lord
            const allPlayerIds = Object.keys(gameState.players);
            const currentLoreLordIndex = allPlayerIds.indexOf(gameState.loreLord);
            gameState.loreLord = allPlayerIds[(currentLoreLordIndex + 1) % allPlayerIds.length];
            break;
    }
    broadcastGameState();
}

function updateUI() {
    if (!gameState.gameStarted) {
        if (isHost) showLobby();
        return;
    }
    showGameArea();
    
    let promptText = gameState.prompt;
    if (gameState.activeStoryteller) {
        promptText += ` - ${gameState.players[gameState.activeStoryteller].name} is telling their story...`;
    } else if (gameState.roundInProgress) {
        promptText += ` - All stories are in! The Lore Lord must now choose the best one.`;
    } else if (gameState.winner) {
        promptText = `${gameState.players[gameState.winner].name} won the round!`;
    }
    document.querySelector('prompt-card').prompt = promptText;

    renderScores();
    renderPlayerHands();
    renderLoreLordControls();
}

function renderLobbyPlayers() {
    lobbyPlayerList.innerHTML = '';
    Object.values(gameState.players).forEach(player => {
        const li = document.createElement('li');
        li.textContent = player.name;
        lobbyPlayerList.appendChild(li);
    });
}

function renderScores() {
    scoresContainer.innerHTML = '<h3>Scores</h3>';
    const list = document.createElement('ul');
    for (const peerId in gameState.scores) {
        const li = document.createElement('li');
        li.textContent = `${gameState.players[peerId].name}: ${gameState.scores[peerId]}`;
        list.appendChild(li);
    }
    scoresContainer.appendChild(list);
}

function renderPlayerHands() {
    playerHandsContainer.innerHTML = '';
    const storytellerIds = Object.keys(gameState.players).filter(id => id !== gameState.loreLord);

    storytellerIds.forEach(peerId => {
        const playerHand = new PlayerHand();
        playerHand.dataset.peerId = peerId;

        playerHand.render({
            name: gameState.players[peerId].name,
            isYou: peerId === myPeerId,
            isLoreLord: false,
            isStoryteller: peerId === gameState.activeStoryteller,
            propCards: gameState.propCards[peerId],
            revealedProps: gameState.revealedProps[peerId],
            storyStatus: gameState.storyStatus[peerId],
            showBestStoryBtn: myPeerId === gameState.loreLord && !gameState.activeStoryteller && gameState.roundInProgress
        });

        playerHand.addEventListener('reveal-prop', e => sendToHost({ type: 'revealProp', payload: e.detail }));
        playerHand.addEventListener('set-truth', e => sendToHost({ type: 'setTruth', payload: e.detail }));
        playerHand.addEventListener('pick-best', e => sendToHost({ type: 'pickBestStory', payload: e.detail }));

        playerHandsContainer.appendChild(playerHand);
    });
}

function renderLoreLordControls() {
    loreLordControlsContainer.innerHTML = '';
    if (myPeerId === gameState.loreLord && !gameState.roundInProgress && isHost) {
        const btn = document.createElement('button');
        btn.textContent = 'Start Next Round';
        btn.addEventListener('click', startNewRound);
        loreLordControlsContainer.appendChild(btn);
    }
}

function sendToHost(action) {
    if (isHost) {
        handleHostAction(myPeerId, action);
    } else {
        Object.values(connections)[0].send({ type: 'action', action });
    }
}

function setupConnectionHandlers(conn) {
    conn.on('data', data => {
        switch (data.type) {
            case 'gameState':
                Object.assign(gameState, data.state);
                updateUI();
                break;
            case 'newPlayer':
                if (isHost) {
                    gameState.players[data.peerId] = data.playerData;
                    gameState.scores[data.peerId] = 0;
                    renderLobbyPlayers();
                    Object.values(connections).forEach(c => c.send({ type: 'lobbyUpdate', players: gameState.players }));
                }
                break;
            case 'lobbyUpdate':
                gameState.players = data.players;
                renderLobbyPlayers();
                break;
            case 'action':
                if (isHost) handleHostAction(conn.peer, data.action);
                break;
        }
    });

    conn.on('open', () => {
        if (!isHost) {
            conn.send({ type: 'newPlayer', peerId: myPeerId, playerData: gameState.players[myPeerId] });
        } else {
            broadcastGameState(); // Send initial state to new player
        }
    });

    conn.on('close', () => {
        if (isHost) {
            delete gameState.players[conn.peer];
            delete connections[conn.peer];
            broadcastGameState();
        }
    });
}

initializePeer();