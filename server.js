const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname)));

// ========== GAME ROOMS ==========
const rooms = new Map();

const WIN_COMBOS = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
];

function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I/O/0/1 to avoid confusion
    let code;
    do {
        code = '';
        for (let i = 0; i < 4; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
    } while (rooms.has(code));
    return code;
}

function createRoom(hostSocketId) {
    const code = generateRoomCode();
    rooms.set(code, {
        code,
        players: [{ id: hostSocketId, symbol: 'X' }],
        board: Array(9).fill(''),
        currentPlayer: 'X',
        gameActive: false, // starts when second player joins
        scores: { X: 0, O: 0, draw: 0 },
    });
    return code;
}

function checkWin(board) {
    for (const combo of WIN_COMBOS) {
        const [a, b, c] = combo;
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return { winner: board[a], combo };
        }
    }
    return null;
}

function checkDraw(board) {
    return board.every(cell => cell !== '');
}

// ========== SOCKET EVENTS ==========
io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);

    // --- Create Room ---
    socket.on('createRoom', () => {
        const code = createRoom(socket.id);
        socket.join(code);
        socket.roomCode = code;
        socket.emit('roomCreated', { code, symbol: 'X' });
        console.log(`Room ${code} created by ${socket.id}`);
    });

    // --- Join Room ---
    socket.on('joinRoom', (code) => {
        code = code.toUpperCase().trim();
        const room = rooms.get(code);

        if (!room) {
            socket.emit('joinError', 'Room not found. Check the code and try again.');
            return;
        }
        if (room.players.length >= 2) {
            socket.emit('joinError', 'Room is full.');
            return;
        }

        room.players.push({ id: socket.id, symbol: 'O' });
        room.gameActive = true;
        // Randomize starting player
        room.currentPlayer = Math.random() < 0.5 ? 'X' : 'O';
        socket.join(code);
        socket.roomCode = code;

        // Notify joiner
        socket.emit('roomJoined', { code, symbol: 'O' });

        // Notify both players to start
        io.to(code).emit('gameStart', {
            board: room.board,
            currentPlayer: room.currentPlayer,
            scores: room.scores,
        });

        console.log(`${socket.id} joined room ${code}`);
    });

    // --- Make Move ---
    socket.on('makeMove', (index) => {
        const code = socket.roomCode;
        if (!code) return;

        const room = rooms.get(code);
        if (!room || !room.gameActive) return;

        // Find this player's symbol
        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        // Validate it's this player's turn
        if (player.symbol !== room.currentPlayer) return;

        // Validate cell is empty
        if (typeof index !== 'number' || index < 0 || index > 8) return;
        if (room.board[index] !== '') return;

        // Place the mark
        room.board[index] = player.symbol;

        // Check win
        const winResult = checkWin(room.board);
        if (winResult) {
            room.gameActive = false;
            room.scores[winResult.winner]++;
            io.to(code).emit('moveMade', {
                index,
                symbol: player.symbol,
                board: room.board,
            });
            io.to(code).emit('gameOver', {
                type: 'win',
                winner: winResult.winner,
                combo: winResult.combo,
                scores: room.scores,
            });
            return;
        }

        // Check draw
        if (checkDraw(room.board)) {
            room.gameActive = false;
            room.scores.draw++;
            io.to(code).emit('moveMade', {
                index,
                symbol: player.symbol,
                board: room.board,
            });
            io.to(code).emit('gameOver', {
                type: 'draw',
                scores: room.scores,
            });
            return;
        }

        // Switch turn
        room.currentPlayer = room.currentPlayer === 'X' ? 'O' : 'X';

        io.to(code).emit('moveMade', {
            index,
            symbol: player.symbol,
            board: room.board,
            currentPlayer: room.currentPlayer,
        });
    });

    // --- Rematch ---
    socket.on('rematch', () => {
        const code = socket.roomCode;
        if (!code) return;

        const room = rooms.get(code);
        if (!room) return;

        // Track rematch votes
        if (!room.rematchVotes) room.rematchVotes = new Set();
        room.rematchVotes.add(socket.id);

        if (room.rematchVotes.size === 2) {
            // Both players want a rematch
            room.board = Array(9).fill('');
            // Randomize starting player for rematch
            room.currentPlayer = Math.random() < 0.5 ? 'X' : 'O';
            room.gameActive = true;
            room.rematchVotes = new Set();

            io.to(code).emit('rematchStart', {
                board: room.board,
                currentPlayer: room.currentPlayer,
                scores: room.scores,
            });
        } else {
            // Notify opponent that this player wants a rematch
            socket.to(code).emit('opponentWantsRematch');
        }
    });

    // --- Disconnect ---
    socket.on('disconnect', () => {
        const code = socket.roomCode;
        if (!code) return;

        const room = rooms.get(code);
        if (!room) return;

        // Notify remaining player
        socket.to(code).emit('opponentDisconnected');

        // Remove player from room
        room.players = room.players.filter(p => p.id !== socket.id);
        room.gameActive = false;

        // Clean up empty rooms
        if (room.players.length === 0) {
            rooms.delete(code);
            console.log(`Room ${code} deleted (empty)`);
        }

        console.log(`Player ${socket.id} disconnected from room ${code}`);
    });

    // --- Leave Room ---
    socket.on('leaveRoom', () => {
        const code = socket.roomCode;
        if (!code) return;

        const room = rooms.get(code);
        if (room) {
            socket.to(code).emit('opponentDisconnected');
            room.players = room.players.filter(p => p.id !== socket.id);
            room.gameActive = false;

            if (room.players.length === 0) {
                rooms.delete(code);
            }
        }

        socket.leave(code);
        socket.roomCode = null;
        socket.emit('leftRoom');
    });
});

server.listen(PORT, () => {
    console.log(`\n🎮 Tic Tac Toe server running at http://localhost:${PORT}\n`);
});
