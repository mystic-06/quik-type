# Speed Typing ⚡

A real-time multiplayer typing test application built with Next.js and Socket.IO.

## Features

### Core Features

- ✅ **Countdown Timer** - 5-second countdown before tests begin
- ✅ **Test Phase Management** - Custom hook for managing different test phases
- ✅ **Socket.IO Integration** - Real-time communication setup
- ✅ **Typing Test Engine** - Word generation and accuracy tracking
- ✅ **Real-time Results** - Live WPM and accuracy calculation

### Multiplayer Features

- ✅ **Room System** - Join/create typing rooms
- ✅ **Synchronized Start** - All players start simultaneously
- ✅ **Results Ranking** - WPM-based leaderboard after each test
- ✅ **Result Submission** - Automatic result collection and ranking
- 🚧 **Live Player Status** - See other players' progress in real-time
- 📋 **Live Cursor** - Show other player's cursor positions in realtime

### UI Components

- ✅ **Header Component** - Navigation and branding
- ✅ **Countdown Phase** - Pre-test countdown display
- ✅ **Setup Phase** - Room configuration and player setup
- ✅ **Results Display** - Post-test statistics and comparison
- ✅ **Multiplayer Results** - Ranked leaderboard with WPM sorting
- ✅ **Typing Area** - Main typing interface

## Tech Stack

- **Frontend**: Next.js 15, React 19, TypeScript
- **Styling**: Tailwind CSS 4
- **Real-time**: Socket.IO
- **Backend**: Express.js server
- **Icons**: Lucide React

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

1. Clone the repository

```bash
git clone <repository-url>
cd speed-typing
```

2. Install dependencies

```bash
npm install
```

3. Copy environment variables

```bash
cp .env.example .env.local
```

### Development

1. Start the Socket.IO server

```bash
npm run server:dev
```

2. Start the Next.js development server

```bash
npm run dev
```

3. Open [http://localhost:3000](http://localhost:3000) in your browser

### Production

1. Build the application

```bash
npm run build
```

2. Start the production server

```bash
npm start
```

3. Start the Socket.IO server

```bash
npm run server
```

## Deployment

### Environment Variables

Set the following environment variables for production:

- `NEXT_PUBLIC_SOCKET_URL`: Your Socket.IO server URL
- `PORT`: Server port (default: 3001)
- `NODE_ENV`: Set to "production"

### Docker Deployment (Optional)

Create a `Dockerfile`:

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 3000 3001
CMD ["sh", "-c", "npm run server & npm start"]
```

### Vercel/Netlify Deployment

1. Deploy the Next.js app to Vercel/Netlify
2. Deploy the Socket.IO server separately (Railway, Render, etc.)
3. Update `NEXT_PUBLIC_SOCKET_URL` to point to your server

## Project Structure

```
src/
├── app/
│   ├── room/[roomId]/     # Dynamic room pages
│   ├── multiplayer/       # Multiplayer lobby
│   ├── leaderboard/       # Score rankings
│   └── page.tsx          # Home page
├── components/
│   ├── CountdownPhase.tsx # Pre-test countdown
│   ├── Header.tsx        # Navigation header
│   ├── SetupPhase.tsx    # Room setup
│   └── TypingArea.tsx    # Main typing interface
├── hooks/
│   ├── useSocket.ts      # Socket.IO connection
│   └── useTestingPhase.ts # Test state management
└── server/
    └── index.js          # Express + Socket.IO server
```

## Development Status

### Legend

- ✅ **Complete** - Feature is implemented and working
- 🚧 **In Progress** - Currently being developed
- 📋 **Planned** - Scheduled for future development

### Current Sprint

- 🚧 Live Player Status - Real-time progress tracking during tests

## Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm start` - Start production server

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is private and not licensed for public use.
