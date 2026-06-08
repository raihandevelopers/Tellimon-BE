# Tellimon Backend

Node.js + Express + MongoDB API for the Tellimon call forwarding panel.

## Setup

```bash
cd backend
npm install
cp .env.example .env   # edit MONGODB_URI if needed
```

### MongoDB (pick one)

**Local MongoDB**
```bash
mongod
```

**Docker**
```bash
docker run -d --name tellimon-mongo -p 27017:27017 mongo:7
```

**MongoDB Atlas** — set `MONGODB_URI` in `.env`:
```
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/tellimon
```

## Run

```bash
npm run dev      # API on http://localhost:5000
```

Demo user is auto-seeded on first start:
- **Email:** `demo@tellimon.com` or `demo`
- **Password:** `demo123`

## API

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/auth/login` | Login |
| GET | `/api/auth/me` | Current user (JWT) |
| GET/POST/DELETE | `/api/buyers` | Buyers CRUD |
| GET/POST/DELETE | `/api/campaigns` | Campaigns CRUD |
| GET/POST/DELETE | `/api/blocked-contacts` | Blocked contacts |
| GET | `/api/dashboard/stats` | Dashboard stats |

## Frontend

From the `Tellimon` folder:
```bash
npm run dev   # proxies /api → localhost:5000
```
