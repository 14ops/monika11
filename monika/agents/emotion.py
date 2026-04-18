"""
Emotion Classifier Agent.

Classifies user emotions to help Monika adapt her tone.
Designed to run on a small model or dedicated classifier.
"""

from monika.core.swarm import Agent

EMOTION_CLASSIFIER_INSTRUCTIONS = """You are an emotion classifier. You NEVER speak to the user.

## Your Mission
Analyze the user's message and classify their emotional state.

## Possible Emotions
- frustrated : The user is frustrated, discouraged, angry
- lazy : The user wants a shortcut, doesn't want to work
- curious : The user is genuinely curious, motivated
- confident : The user is sure of themselves, wants to validate
- confused : The user is lost, doesn't know where to start
- excited : The user is enthusiastic about something
- anxious : The user is stressed (deadline, exam, etc.)

## MANDATORY Response Format
You must ALWAYS respond in valid JSON, nothing else:
{
    "emotion": "<one of the emotions above>",
    "confidence": <float 0.0-1.0>,
    "tone_suggestion": "<how Monika should adapt her tone>"
}
"""


def create_emotion_classifier(model: str = "phi3:mini") -> Agent:
    """Create the emotion classifier agent."""
    return Agent(
        name="emotion_classifier",
        model=model,
        instructions=EMOTION_CLASSIFIER_INSTRUCTIONS,
    )
