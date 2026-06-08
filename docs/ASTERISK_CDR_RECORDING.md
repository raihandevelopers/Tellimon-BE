# Asterisk → Tellimon: Duration & Recordings

When a call ends, Asterisk must POST to Tellimon so duration and recordings show in Call Reports.

## Webhook endpoint

```
POST https://YOUR-API/api/calls/webhook
Header: x-asterisk-secret: YOUR_ASTERISK_WEBHOOK_SECRET
```

## Body (JSON)

```json
{
  "userId": "MONGODB_USER_ID",
  "caller": "+15551234567",
  "did": "+18005550100",
  "buyerNumber": "+15559876543",
  "buyerId": "optional-buyer-id",
  "campaignId": "optional-campaign-id",
  "status": "answered",
  "duration": 125,
  "billsec": 98,
  "uniqueId": "asterisk-unique-call-id",
  "recordingUrl": "https://your-server/recordings/call-123.wav",
  "recordingPath": "/var/spool/asterisk/monitor/call-123.wav",
  "startedAt": "2026-06-07T10:00:00.000Z",
  "endedAt": "2026-06-07T10:02:05.000Z"
}
```

### Field meanings

| Field | Meaning |
|-------|---------|
| `duration` | Total call time (ring + talk) in seconds |
| `billsec` | Talk time only (what you usually bill on) |
| `status` | `answered`, `missed`, `busy`, `failed`, `no-answer` |
| `recordingUrl` | Public URL to play/download in panel |
| `uniqueId` | Prevents duplicate CDR rows |

## Asterisk dialplan example

```ini
[from-trunk]
exten => _X.,1,NoOp(Incoming call from ${CALLERID(num)})
 same => n,Set(RECORDING=/var/spool/asterisk/monitor/${UNIQUEID}.wav)
 same => n,MixMonitor(${RECORDING},b)
 same => n,Set(START=${EPOCH})
 same => n,Dial(PJSIP/buyer,60)
 same => n,Set(END=${EPOCH})
 same => n,Set(DURATION=$[${END}-${START}])
 same => n,System(curl -s -X POST https://YOUR-API/api/calls/webhook \
   -H "Content-Type: application/json" \
   -H "x-asterisk-secret: YOUR_SECRET" \
   -d '{"userId":"USER_ID","caller":"${CALLERID(num)}","did":"${EXTEN}","status":"${DIALSTATUS}","duration":${DURATION},"billsec":${CDR(billsec)},"uniqueId":"${UNIQUEID}","recordingUrl":"https://YOUR-SERVER/recordings/${UNIQUEID}.wav","startedAt":"..."}')
 same => n,Hangup()
```

## Recording storage options

1. **Local on VPS** — MixMonitor saves `.wav`, nginx serves `/recordings/`
2. **S3 / Cloudflare R2** — upload after call, store URL in MongoDB
3. **Twilio** — if using Twilio, recordings URL comes from their API

## Panel pages that use this data

- **Call Reports** — full list + play recording
- **Dashboard** — total / answered / missed counts
- **Live Calls** — needs AMI events (separate from CDR webhook)
