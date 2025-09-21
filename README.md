# Speed Typing ⚡

A real-time multiplayer typing test application built with Next.js and Socket.IO.

## Features

### Core Features

- ✅ **Countdown Timer** - 5-second countdown before tests begin
- ✅ **Test Phase Management** - Custom hook for managing different test phases
- ✅ **Socket.IO Integration** - Real-time communication setup
- ✅ **Typing Test Engine** - Word generation and accuracy tracking
- 🚧 **Real-time Results** - Live WPM and accuracy calculation

### Multiplayer Features

- ✅ **Room System** - Join/create typing rooms
- 🚧 **Live Player Status** - See other players' progress in real-time
- 🚧 **Synchronized Start** - All players start simultaneously
- 📋 **Leaderboard** - Track high scores and rankings

### UI Components

- ✅ **Header Component** - Navigation and branding
- ✅ **Countdown Phase** - Pre-test countdown display
- ✅ **Setup Phase** - Room configuration and player setup
- ✅ **Results Display** - Post-test statistics and comparison
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

3. Start the development server

```bash
npm run dev
```

4. Start the Socket.IO server

```bash
node server/index.js
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser

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

- 🚧 Synchronized Start

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
