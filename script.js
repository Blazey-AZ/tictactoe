(() => {
    'use strict';

    // ========== SOCKET.IO ==========
    const socket = io();

    // ========== STATE ==========
    const state = {
        mySymbol: null,      // 'X' or 'O' assigned by server
        roomCode: null,
        board: Array(9).fill(''),
        currentPlayer: 'X',
        gameActive: false,
        scores: { X: 0, O: 0, draw: 0 },
    };

    const WIN_LINE_COORDS = {
        '0,1,2': { x1: 13, y1: 16, x2: 87, y2: 16 },
        '3,4,5': { x1: 13, y1: 50, x2: 87, y2: 50 },
        '6,7,8': { x1: 13, y1: 84, x2: 87, y2: 84 },
        '0,3,6': { x1: 16, y1: 13, x2: 16, y2: 87 },
        '1,4,7': { x1: 50, y1: 13, x2: 50, y2: 87 },
        '2,5,8': { x1: 84, y1: 13, x2: 84, y2: 87 },
        '0,4,8': { x1: 10, y1: 10, x2: 90, y2: 90 },
        '2,4,6': { x1: 90, y1: 10, x2: 10, y2: 90 },
    };

    // ========== DOM ==========
    // Lobby
    const lobbyEl = document.getElementById('lobby');
    const lobbyCard = document.getElementById('lobby-card');
    const waitingCard = document.getElementById('waiting-card');
    const createRoomBtn = document.getElementById('create-room-btn');
    const joinRoomBtn = document.getElementById('join-room-btn');
    const roomCodeInput = document.getElementById('room-code-input');
    const lobbyError = document.getElementById('lobby-error');
    const roomCodeDisplay = document.getElementById('room-code-display');
    const cancelRoomBtn = document.getElementById('cancel-room-btn');

    // Game
    const gameEl = document.getElementById('game');
    const cells = document.querySelectorAll('.cell');
    const turnIndicator = document.getElementById('turn-indicator');
    const turnIcon = document.getElementById('turn-icon');
    const scoreX = document.getElementById('score-x');
    const scoreO = document.getElementById('score-o');
    const scoreDraw = document.getElementById('score-draw');
    const statusEl = document.getElementById('status');
    const rematchBtn = document.getElementById('rematch-btn');
    const leaveBtn = document.getElementById('leave-btn');
    const gameRoomCode = document.getElementById('game-room-code');
    const playerBadge = document.getElementById('player-badge');
    const winLine = document.getElementById('win-line');

    // Modal
    const modalOverlay = document.getElementById('modal-overlay');
    const modalIcon = document.getElementById('modal-icon');
    const modalTitle = document.getElementById('modal-title');
    const modalMessage = document.getElementById('modal-message');
    const modalBtn = document.getElementById('modal-btn');

    // ========== INIT ==========
    function init() {
        // Lobby events
        createRoomBtn.addEventListener('click', handleCreateRoom);
        joinRoomBtn.addEventListener('click', handleJoinRoom);
        roomCodeInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleJoinRoom();
        });
        roomCodeInput.addEventListener('input', () => {
            roomCodeInput.value = roomCodeInput.value.toUpperCase();
            lobbyError.textContent = '';
        });
        cancelRoomBtn.addEventListener('click', handleCancelRoom);

        // Game events
        cells.forEach(cell => cell.addEventListener('click', handleCellClick));
        rematchBtn.addEventListener('click', handleRematch);
        leaveBtn.addEventListener('click', handleLeaveRoom);
        modalBtn.addEventListener('click', handleRematch);
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) closeModal();
        });

        // Socket events
        setupSocketListeners();
    }

    // ========== LOBBY LOGIC ==========
    function handleCreateRoom() {
        createRoomBtn.disabled = true;
        socket.emit('createRoom');
    }

    function handleJoinRoom() {
        const code = roomCodeInput.value.trim().toUpperCase();
        if (code.length !== 4) {
            lobbyError.textContent = 'Please enter a 4-character room code.';
            return;
        }
        joinRoomBtn.disabled = true;
        lobbyError.textContent = '';
        socket.emit('joinRoom', code);
    }

    function handleCancelRoom() {
        socket.emit('leaveRoom');
        showLobby();
    }

    function handleLeaveRoom() {
        socket.emit('leaveRoom');
        showLobby();
    }

    function showLobby() {
        state.roomCode = null;
        state.mySymbol = null;
        state.gameActive = false;

        gameEl.classList.add('hidden');
        lobbyEl.classList.remove('hidden');
        lobbyCard.classList.remove('hidden');
        waitingCard.classList.add('hidden');

        createRoomBtn.disabled = false;
        joinRoomBtn.disabled = false;
        roomCodeInput.value = '';
        lobbyError.textContent = '';

        closeModal();
        resetBoardUI();
    }

    function showWaiting(code) {
        lobbyCard.classList.add('hidden');
        waitingCard.classList.remove('hidden');
        roomCodeDisplay.textContent = code;
    }

    function showGame() {
        lobbyEl.classList.add('hidden');
        gameEl.classList.remove('hidden');
        gameRoomCode.textContent = `Room: ${state.roomCode}`;
        playerBadge.textContent = `You are ${state.mySymbol}`;
        playerBadge.className = `player-badge player-${state.mySymbol.toLowerCase()}`;
    }

    // ========== SOCKET LISTENERS ==========
    function setupSocketListeners() {
        socket.on('roomCreated', ({ code, symbol }) => {
            state.roomCode = code;
            state.mySymbol = symbol;
            showWaiting(code);
        });

        socket.on('roomJoined', ({ code, symbol }) => {
            state.roomCode = code;
            state.mySymbol = symbol;
        });

        socket.on('joinError', (msg) => {
            lobbyError.textContent = msg;
            joinRoomBtn.disabled = false;
        });

        socket.on('gameStart', ({ board, currentPlayer, scores, yourSymbol, roomCode }) => {
            state.board = board;
            state.currentPlayer = currentPlayer;
            state.scores = scores;
            state.mySymbol = yourSymbol;
            state.roomCode = roomCode;
            state.gameActive = true;

            showGame();
            updateScoreboard();
            updateTurnIndicator();
            resetBoardUI();
            rematchBtn.classList.add('hidden');
            statusEl.textContent = '';
        });

        socket.on('moveMade', ({ index, symbol, board, currentPlayer }) => {
            state.board = board;
            if (currentPlayer) state.currentPlayer = currentPlayer;

            // Update the cell UI
            const cell = cells[index];
            const imgSrc = symbol === 'X' ? 'player_x.png' : 'player_o.png';
            cell.innerHTML = `<img src="${imgSrc}" class="cell-icon" alt="${symbol}">`;
            cell.classList.add('taken', symbol.toLowerCase());

            updateTurnIndicator();
        });

        socket.on('gameOver', ({ type, winner, combo, scores }) => {
            state.gameActive = false;
            state.scores = scores;
            updateScoreboard();

            if (type === 'win') {
                // Highlight winning cells
                combo.forEach(i => cells[i].classList.add('win-cell'));
                drawWinLine(combo);

                const isMe = winner === state.mySymbol;
                const color = winner === 'X' ? 'var(--color-x)' : 'var(--color-o)';

                setTimeout(() => {
                    showModal(
                        isMe ? '🎉' : '😔',
                        isMe ? 'You Win!' : `Player ${winner} Wins!`,
                        isMe ? 'Great game! Play again?' : 'Better luck next time!',
                        color
                    );
                    if (isMe) spawnConfetti();
                }, 700);
            } else {
                cells.forEach(cell => cell.style.opacity = '0.6');
                setTimeout(() => {
                    showModal('🤝', "It's a Draw!", 'No winner this time.', 'var(--color-draw)');
                }, 500);
            }

            rematchBtn.classList.remove('hidden');
        });

        socket.on('opponentWantsRematch', () => {
            statusEl.textContent = 'Opponent wants a rematch!';
            statusEl.style.color = 'var(--color-draw)';
        });

        socket.on('rematchStart', ({ board, currentPlayer, scores, yourSymbol }) => {
            closeModal();
            state.board = board;
            state.currentPlayer = currentPlayer;
            state.scores = scores;
            state.mySymbol = yourSymbol;
            state.gameActive = true;

            showGame(); // Refresh badge in case symbol changed
            resetBoardUI();
            updateScoreboard();
            updateTurnIndicator();
            rematchBtn.classList.add('hidden');
            statusEl.textContent = '';
            statusEl.style.color = '';
        });

        socket.on('opponentDisconnected', () => {
            state.gameActive = false;
            closeModal();
            showModal(
                '👋',
                'Opponent Left',
                'Your opponent has disconnected.',
                'var(--text-secondary)'
            );
            // Change modal button to go back to lobby
            modalBtn.textContent = 'Back to Lobby';
            modalBtn.onclick = () => {
                modalBtn.textContent = 'Rematch';
                modalBtn.onclick = handleRematch;
                showLobby();
            };
        });

        socket.on('leftRoom', () => {
            showLobby();
        });
    }

    // ========== GAME LOGIC ==========
    function handleCellClick(e) {
        if (!state.gameActive) return;

        // Only allow clicks on my turn
        if (state.currentPlayer !== state.mySymbol) return;

        const index = parseInt(e.target.dataset.index);
        if (state.board[index] !== '') return;

        // Send move to server — the server is the source of truth
        socket.emit('makeMove', index);
    }

    function handleRematch() {
        socket.emit('rematch');
        statusEl.textContent = 'Waiting for opponent...';
        statusEl.style.color = 'var(--text-secondary)';
        rematchBtn.disabled = true;
        closeModal();

        setTimeout(() => {
            rematchBtn.disabled = false;
        }, 500);
    }

    // ========== UI UPDATES ==========
    function updateTurnIndicator() {
        const isMyTurn = state.currentPlayer === state.mySymbol;
        turnIcon.src = state.currentPlayer === 'X' ? 'player_x.png' : 'player_o.png';
        turnText.textContent = isMyTurn ? "'s Turn (You)" : "'s Turn";
        turnIndicator.className = 'turn-indicator ' + (state.currentPlayer === 'X' ? 'x-turn' : 'o-turn');

        // Visual feedback: dim board when not your turn
        const board = document.getElementById('board');
        if (isMyTurn) {
            board.classList.remove('opponent-turn');
        } else {
            board.classList.add('opponent-turn');
        }
    }

    function updateScoreboard() {
        animateScore(scoreX, state.scores.X);
        animateScore(scoreO, state.scores.O);
        animateScore(scoreDraw, state.scores.draw);
    }

    function animateScore(el, value) {
        const current = parseInt(el.textContent);
        if (current !== value) {
            el.textContent = value;
            el.style.transform = 'scale(1.3)';
            setTimeout(() => el.style.transition = 'transform 0.3s ease', 0);
            setTimeout(() => el.style.transform = 'scale(1)', 50);
        }
    }

    function resetBoardUI() {
        cells.forEach(cell => {
            cell.innerHTML = '';
            cell.className = 'cell';
            cell.style.opacity = '';
        });

        winLine.classList.remove('visible');
        winLine.setAttribute('x1', 0);
        winLine.setAttribute('y1', 0);
        winLine.setAttribute('x2', 0);
        winLine.setAttribute('y2', 0);
    }

    function drawWinLine(combo) {
        const key = combo.join(',');
        const coords = WIN_LINE_COORDS[key];
        if (!coords) return;

        winLine.setAttribute('x1', coords.x1);
        winLine.setAttribute('y1', coords.y1);
        winLine.setAttribute('x2', coords.x2);
        winLine.setAttribute('y2', coords.y2);

        void winLine.getBoundingClientRect();
        winLine.classList.add('visible');
    }

    // ========== MODAL ==========
    function showModal(icon, title, message, accentColor) {
        modalIcon.textContent = icon;
        modalTitle.textContent = title;
        modalTitle.style.color = accentColor;
        modalMessage.textContent = message;
        modalOverlay.classList.add('active');
    }

    function closeModal() {
        modalOverlay.classList.remove('active');
    }

    // ========== CONFETTI ==========
    function spawnConfetti() {
        const colors = ['#6c63ff', '#ff6b9d', '#ffd166', '#06d6a0', '#118ab2', '#ef476f'];
        const count = 50;

        for (let i = 0; i < count; i++) {
            const confetti = document.createElement('div');
            confetti.classList.add('confetti');
            confetti.style.left = Math.random() * 100 + 'vw';
            confetti.style.top = -10 + 'px';
            confetti.style.background = colors[Math.floor(Math.random() * colors.length)];
            confetti.style.width = (Math.random() * 8 + 4) + 'px';
            confetti.style.height = (Math.random() * 8 + 4) + 'px';
            confetti.style.animationDuration = (Math.random() * 1.5 + 0.8) + 's';
            confetti.style.animationDelay = (Math.random() * 0.4) + 's';
            document.body.appendChild(confetti);

            setTimeout(() => confetti.remove(), 2500);
        }
    }

    // Start
    init();
})();
