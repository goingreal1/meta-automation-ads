"""Revora voice agent: answers WhatsApp calls that arrive over SIP and talks to the caller.

How a call reaches this file
  customer taps the call button in WhatsApp
    -> Meta sends the call as SIP (TLS, port 5061) to the SIP server set in Meta's Call settings (Developer settings -> SIP)
    -> LiveKit SIP receives it (an "inbound trunk") and a dispatch rule puts the caller into a LiveKit room
    -> LiveKit starts this worker for that room, which joins and talks to the caller.

Run locally:   python agent.py dev          Deploy: see README.md
NOT YET TESTED with a real WhatsApp call: it needs the LiveKit and Meta settings in README.md first.
"""
import os

from dotenv import load_dotenv
from livekit import agents
from livekit.agents import Agent, AgentSession, JobContext, WorkerOptions, cli

load_dotenv()

# One switch decides how the AI listens and speaks:
#   VOICE_MODE=realtime  -> OpenAI Realtime (speech in, speech out; usually the quickest to answer)
#   VOICE_MODE=eleven    -> speech-to-text -> AI -> ElevenLabs voice (more choice of accent; a little slower)
VOICE_MODE = os.getenv("VOICE_MODE", "realtime")

INSTRUCTIONS = """You are the voice of a Nigerian online store's sales line, talking to a customer on a WhatsApp call.
Speak the way a friendly, respectful Nigerian customer-care person speaks: warm, clear, natural Nigerian English. If the caller speaks Pidgin,
answer in light Pidgin. Keep every turn short (one or two sentences), then stop and let them talk. Never read lists or long paragraphs.
Always: greet, find out what they want to order or ask, give only facts you were given, offer to take their delivery address and phone number,
and say a person will confirm the order. Pay on delivery is how most customers order.
Never: promise a cure or a medical result, invent a price, stock level or delivery date, ask for card details, or pretend to be a human if asked.
If you are not sure, say you will have a team member call back or message them on WhatsApp."""


def build_session() -> AgentSession:
    if VOICE_MODE == "eleven":
        from livekit.plugins import elevenlabs, openai, silero

        return AgentSession(
            vad=silero.VAD.load(),
            stt=openai.STT(),
            llm=openai.LLM(model=os.getenv("LLM_MODEL", "gpt-4o-mini")),
            tts=elevenlabs.TTS(voice_id=os.getenv("ELEVENLABS_VOICE_ID", ""), model="eleven_flash_v2_5"),
        )
    from livekit.plugins import openai

    return AgentSession(llm=openai.realtime.RealtimeModel(voice=os.getenv("OPENAI_VOICE", "alloy")))


async def entrypoint(ctx: JobContext):
    await ctx.connect()
    session = build_session()
    await session.start(room=ctx.room, agent=Agent(instructions=INSTRUCTIONS))
    await session.generate_reply(instructions="Greet the caller warmly in one short sentence and ask how you can help.")


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
