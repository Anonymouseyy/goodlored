const roomCreationDiv = document.getElementById('room-creation');
const gameAreaDiv = document.getElementById('game-area');
const createRoomBtn = document.getElementById('create-room-btn');
const joinRoomBtn = document.getElementById('join-room-btn');
const roomIdDisplay = document.getElementById('room-id-display');
const joinRoomInput = document.getElementById('join-room-input');
const playerHandsContainer = document.getElementById('player-hands');
const loreLordControlsContainer = document.getElementById('lore-lord-controls');
const scoresContainer = document.getElementById('scores');

let peer;
const connections = {}; // Store connections by peerId
let isHost = false;
let myPeerId;

const gameState = {
    players: {},
    prompt: '',
    stories: {},
    loreLord: null,
    scores: {},
    roundInProgress: false,
    winner: null,
};

class PromptCard extends HTMLElement {
    constructor() {
        super();
        const template = document.getElementById('prompt-card-template').content;
        this.attachShadow({ mode: 'open' }).appendChild(template.cloneNode(true));
        this.promptTextElement = this.shadowRoot.querySelector('.prompt-text');
    }

    set prompt(text) {
        this.promptTextElement.textContent = text;
    }
}

customElements.define('prompt-card', PromptCard);

class PlayerHand extends HTMLElement {
    constructor() {
        super();
        const template = document.getElementById('player-hand-template').content;
        this.attachShadow({ mode: 'open' }).appendChild(template.cloneNode(true));
        this.playerNameElement = this.shadowRoot.querySelector('.player-name');
        this.storyTextElement = this.shadowRoot.querySelector('.story-text');
        this.submitStoryBtn = this.shadowRoot.querySelector('.submit-story-btn');
        this.voteBtn = this.shadowRoot.querySelector('.vote-btn');

        this.submitStoryBtn.addEventListener('click', () => {
            this.dispatchEvent(new CustomEvent('story-submit', {
                detail: { story: this.storyTextElement.innerText }
            }));
            this.storyTextElement.contentEditable = false;
            this.submitStoryBtn.style.display = 'none';
        });
        
        this.voteBtn.addEventListener('click', () => {
            this.dispatchEvent(new CustomEvent('vote', {
                detail: { votedFor: this.dataset.peerId }
            }));
        });
    }

    setPlayer(name) {
        this.playerNameElement.textContent = name;
    }

    setStory(story) {
        this.storyTextElement.innerText = story;
    }

    enableStoryEditing() {
        this.storyTextElement.contentEditable = true;
        this.submitStoryBtn.style.display = 'block';
    }
    
    showVoteButton() {
        this.voteBtn.style.display = 'block';
    }
}

customElements.define('player-hand', PlayerHand);


// Initialize PeerJS
function initializePeer() {
    peer = new Peer();

    peer.on('open', (id) => {
        console.log('My peer ID is: ' + id);
        myPeerId = id;
        gameState.players[myPeerId] = { name: `You` };
        if (!gameState.scores[myPeerId]) {
            gameState.scores[myPeerId] = 0;
        }
    });

    peer.on('connection', (connection) => {
        if(isHost){
            console.log('Host received connection from: ' + connection.peer);
            connections[connection.peer] = connection;
            setupConnectionHandlers(connection);
        } else {
             console.log('Client connected to host: ' + connection.peer);
        }
    });

    peer.on('error', (err) => {
        console.error('PeerJS error:', err);
        alert('An error occurred with PeerJS. Please try again.');
    });
}

function showGameArea() {
    roomCreationDiv.style.display = 'none';
    gameAreaDiv.style.display = 'block';
}

createRoomBtn.addEventListener('click', () => {
    isHost = true;
    roomIdDisplay.textContent = `Your Room ID is: ${peer.id}`;
    createRoomBtn.disabled = true;
    joinRoomInput.disabled = true;
    gameState.loreLord = myPeerId;
    const startGameBtn = document.createElement('button');
    startGameBtn.textContent = 'Start Game';
    startGameBtn.id = 'start-game-btn';
    startGameBtn.addEventListener('click', startGame);
    roomCreationDiv.appendChild(startGameBtn);
    updateUI();
});

function startGame() {
    if (isHost) {
        gameState.prompt = prompts[Math.floor(Math.random() * prompts.length)];
        gameState.stories = {};
        gameState.roundInProgress = true;
        gameState.winner = null;
        broadcastGameState();
        showGameArea();
    }
}

joinRoomBtn.addEventListener('click', () => {
    const roomId = joinRoomInput.value.trim();
    if (roomId) {
        const conn = peer.connect(roomId);
        connections[roomId] = conn;
        setupConnectionHandlers(conn);
    }
});

function broadcastGameState() {
    const message = { type: 'gameState', state: gameState };
    for (const peerId in connections) {
        connections[peerId].send(message);
    }
    updateUI();
}

function handleStorySubmission(peerId, story) {
    if (isHost) {
        gameState.stories[peerId] = story;
        const expectedStoryCount = Object.keys(gameState.players).length - 1;
        if (Object.keys(gameState.stories).length === expectedStoryCount) {
            broadcastGameState();
        }
    }
}

function handleVote(votedFor) {
    if (isHost) {
        gameState.scores[votedFor] = (gameState.scores[votedFor] || 0) + 1;
        gameState.winner = votedFor;
        gameState.roundInProgress = false;

        // Rotate Lore Lord
        const playerIds = Object.keys(gameState.players);
        const currentLoreLordIndex = playerIds.indexOf(gameState.loreLord);
        const nextLoreLordIndex = (currentLoreLordIndex + 1) % playerIds.length;
        gameState.loreLord = playerIds[nextLoreLordIndex];

        broadcastGameState();
    }
}

function updateUI() {
    document.querySelector('prompt-card').prompt = gameState.winner ? `${gameState.players[gameState.winner].name} wins the round!` : gameState.prompt || "Waiting for game to start...";
    renderPlayerHands();
    renderLoreLordControls();
    renderScores();
}

function renderPlayerHands() {
    playerHandsContainer.innerHTML = '';
    const allStoriesIn = Object.keys(gameState.stories).length === Object.keys(gameState.players).length - 1;

    for (const peerId in gameState.players) {
        const player = gameState.players[peerId];
        const playerHand = new PlayerHand();
        playerHand.dataset.peerId = peerId;
        playerHand.setPlayer(player.name + (peerId === myPeerId ? ' (You)' : '') + (peerId === gameState.loreLord ? ' (Lore Lord)' : ''));

        if (gameState.stories[peerId]) {
            playerHand.setStory(gameState.stories[peerId]);
        }

        if (peerId === myPeerId && myPeerId !== gameState.loreLord && gameState.roundInProgress && !gameState.stories[myPeerId]) {
            playerHand.enableStoryEditing();
        } else if (myPeerId === gameState.loreLord && allStoriesIn && peerId !== myPeerId) {
            playerHand.showVoteButton();
        }
        
        playerHand.addEventListener('story-submit', (e) => {
            const { story } = e.detail;
            if (isHost) {
                handleStorySubmission(myPeerId, story);
            } else {
                const hostId = Object.keys(connections)[0];
                connections[hostId].send({ type: 'storySubmit', story: story });
            }
        });

        playerHand.addEventListener('vote', (e) => {
             if (isHost) {
                handleVote(e.detail.votedFor);
            } else {
                const hostId = Object.keys(connections)[0];
                connections[hostId].send({ type: 'vote', votedFor: e.detail.votedFor });
            }
        });

        playerHandsContainer.appendChild(playerHand);
    }
}

function renderLoreLordControls(){
    loreLordControlsContainer.innerHTML = '';
    if(myPeerId === gameState.loreLord && !gameState.roundInProgress && isHost){
        const nextRoundBtn = document.createElement('button');
        nextRoundBtn.textContent = 'Start Next Round';
        nextRoundBtn.addEventListener('click', startGame);
        loreLordControlsContainer.appendChild(nextRoundBtn);
    }
}

function renderScores() {
    scoresContainer.innerHTML = '<h3>Scores</h3>';
    const scoresList = document.createElement('ul');
    for (const peerId in gameState.scores) {
        const scoreItem = document.createElement('li');
        scoreItem.textContent = `${gameState.players[peerId].name}: ${gameState.scores[peerId]}`;
        scoresList.appendChild(scoreItem);
    }
    scoresContainer.appendChild(scoresList);
}

function setupConnectionHandlers(conn) {
    conn.on('data', (data) => {
        console.log('Received:', data);
        switch (data.type) {
            case 'gameState':
                Object.assign(gameState, data.state);
                showGameArea();
                updateUI();
                break;
            case 'newPlayer': // Sent from new client to host
                if (isHost) {
                    gameState.players[data.peerId] = data.playerData;
                    if (!gameState.scores[data.peerId]) {
                        gameState.scores[data.peerId] = 0;
                    }
                    broadcastGameState();
                }
                break;
            case 'storySubmit': // Sent from client to host
                handleStorySubmission(conn.peer, data.story);
                break;
            case 'vote': // Sent from client to host
                handleVote(data.votedFor);
                break;
        }
    });

    conn.on('open', () => {
        console.log(`Connection to ${conn.peer} opened.`);
        if (!isHost) {
            conn.send({ type: 'newPlayer', peerId: myPeerId, playerData: gameState.players[myPeerId] });
        } 
    });

    conn.on('close', () => {
        console.log(`Connection to ${conn.peer} closed.`);
        if(isHost){
            delete gameState.players[conn.peer];
            delete connections[conn.peer];
            broadcastGameState();
        }
    });

    conn.on('error', (err) => {
        console.error('Connection error:', err);
        alert('A connection error occurred.');
    });
}

initializePeer();
