# Revora voice agent (WhatsApp calls over SIP)

Meta's Calling API can hand a WhatsApp call to a SIP server instead of sending webhooks. LiveKit runs that SIP server and the AI,
so Revora needs no code of its own to carry the audio.

**Direction that works for a Nigerian number:** the customer calls the business. Meta refuses business-started calls for +234 numbers.

## One-time setup (about 20 minutes)
1. **LiveKit Cloud**: create a project. Note the project URL, API key and secret.
2. **SIP inbound trunk** (LiveKit dashboard, Telephony, SIP trunks, Inbound): create one. Copy its SIP host name
   (it looks like `<project>.sip.livekit.cloud`). Use the TLS port **5061**. Meta requires a valid TLS certificate; LiveKit Cloud has one.
3. **Dispatch rule**: send each new caller into a fresh room and start the agent named in this repo (`agent.py`).
4. **Meta**: WhatsApp Manager -> Phone numbers -> Sofi -> Call settings -> Developer settings -> *Use Session Initiation Protocol (SIP)* -> Set up:
   SIP server = the LiveKit host name, SIP port = 5061, App ID = our Meta app id, then Save.
5. **Run the agent**: `pip install -r requirements.txt`, copy `.env.example` to `.env`, fill it, then `python agent.py dev`
   (LiveKit Cloud can also host it: `lk agent deploy`).
6. **Test**: from your own WhatsApp, open a message that has a call button (or turn on Display call buttons) and call +234 805 648 7759.

## Choosing the voice
`VOICE_MODE=realtime` uses OpenAI's realtime voice (fast). `VOICE_MODE=eleven` uses ElevenLabs: audition voices in their library for a Nigerian accent
and put the chosen voice id in `ELEVENLABS_VOICE_ID`. We have not heard either yet; expect to try a few.

## What is not built yet
Giving the AI the real product facts, prices and the caller's order history; saving the call and a transcript into the Inbox; handing the call to a person.
