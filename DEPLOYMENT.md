# Deployment Checklist

## Pre-deployment

- [ ] All console.log statements removed from production code
- [ ] Environment variables configured
- [ ] Build process tested locally
- [ ] Server and client tested together

## Environment Setup

### Required Environment Variables

```bash
# Client (Next.js)
NEXT_PUBLIC_SOCKET_URL=https://your-server-domain.com

# Server (Socket.IO)
PORT=3001
NODE_ENV=production
```

## Deployment Steps

### 1. Frontend (Next.js)

**Vercel:**
```bash
npm run build
# Deploy to Vercel via GitHub integration
```

**Manual:**
```bash
npm run build
npm start
```

### 2. Backend (Socket.IO Server)

**Railway/Render:**
```bash
# Deploy server/index.js
# Set PORT environment variable
```

**Manual:**
```bash
npm run server
```

### 3. Post-deployment

- [ ] Test single-player mode
- [ ] Test multiplayer room creation
- [ ] Test multiplayer gameplay
- [ ] Test results display
- [ ] Verify WebSocket connections
- [ ] Check error handling

## Performance Considerations

- Server handles up to 8 players per room
- Automatic room cleanup after 24 hours
- Connection state recovery enabled
- Graceful disconnection handling

## Monitoring

- Server logs essential events only
- Health check endpoint: `/health`
- Room debug endpoint: `/debug/rooms`
- Connection status visible in UI