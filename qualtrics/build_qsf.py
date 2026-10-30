"""Builds the full study survey as a Qualtrics import file (.qsf).

    python3 qualtrics/build_qsf.py

Writes qualtrics/Even_Handed_Chatbot.qsf. Import it in Qualtrics with
Create project -> Survey -> "Import a QSF file". The chat and topic-phrase
questions get chat-core.js pasted in from this repo, so rebuild after any change
to chat-core.js, adapter.js or topic-phrase.js.

Survey text follows "Even_Handed_Chatbot_Materials_Final.docx".
"""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(HERE, "Even_Handed_Chatbot.qsf")
SURVEY_ID = "SV_evenHandedChat01"
N_MESSAGES = 7  # participant messages; must match max_messages in adapter.js


def read(path):
    with open(os.path.join(ROOT, path), encoding="utf-8") as f:
        return f.read()


def strip_header_comment(js):
    # The file headers mention ${...} piped text; Qualtrics would try to pipe it.
    return re.sub(r"^/\*.*?\*/\s*", "", js, count=1, flags=re.S)


CHAT_CORE = read("chat-core.js")
CHAT_JS = CHAT_CORE + "\n\n" + strip_header_comment(read("qualtrics/adapter.js"))
PHRASE_JS = CHAT_CORE + "\n\n" + strip_header_comment(read("qualtrics/topic-phrase.js"))
CHAT_HTML = read("qualtrics/question.html").strip()
for js in (CHAT_JS, PHRASE_JS):
    assert "${" not in js, "Qualtrics would treat ${...} in question JavaScript as piped text"
assert "max_messages: %d" % N_MESSAGES in CHAT_JS

# Chat window styles (from the launched survey, plus the multi-line input box).
CUSTOM_CSS = """body { margin: 0; padding: 0; }
#chat-container { width: 100%; height: 100vh; max-height: 600px; border: 1px solid #ddd; border-radius: 10px; overflow: hidden; display: flex; flex-direction: column; justify-content: space-between; margin: 0 auto; font-size: 16px; }
#chat-history-1 { height: calc(100% - 56px); overflow-y: auto; padding: 10px; }
.message { display: flex; flex-direction: column; margin: 10px 0; white-space: pre-wrap; }
.user-message { margin-left: auto; max-width: 70%; padding: 0.5rem .875rem; border-radius: 12px 12px 0 12px; line-height: 1.5; word-wrap: break-word; position: relative; width: fit-content; font-family: helvetica; background-color: #007AFF; color: white; }
.bot-message { max-width: 70%; padding: 0.5rem .875rem; border-radius: 12px 12px 12px 0; line-height: 1.5; word-wrap: break-word; position: relative; width: fit-content; font-family: helvetica; background-color: #F2F2F2; color: #333; }
.bot-message.typing { font-style: italic; color: #888; }
.bot-message.error { background: #fdecea; }
.user-message.failed { opacity: .55; }
#chat-input { display: flex; align-items: flex-end; padding: 10px; background-color: #F9F9F9; width: 100%; box-sizing: border-box; }
#message-input-1 { flex: 1; margin-right: 10px; padding: 10px; border: 1px solid #ddd; border-radius: 5px; box-sizing: border-box; font-size: 16px; font-family: inherit; resize: none; overflow-y: auto; line-height: 1.4; max-height: calc(6 * 1.4em + 16px); }
#send-button-1 { background-color: #007AFF; border: none; color: white; padding: 10px; border-radius: 5px; cursor: pointer; transition: background-color 0.3s ease; }
#send-button-1:hover { background-color: #0066CC; }"""

# ---------------------------------------------------------------- survey text
INTRO = ("Today, you will be chatting with an AI chatbot designed specifically for this study. We are interested in "
         "understanding how humans and AI models can interact and engage in discussions around various topics.")

HIGH_PROMPT = ("For the first task, we would like for you to think of an important belief or attitude you have that is "
               "connected to your morals and that you feel strongly committed to. This belief is different for "
               "different people but could include things, such as views on abortion, gun control, capital punishment, "
               "religion, medical decision, same-sex marriage, etc. What attitude or belief do you care deeply about "
               "and feel strongly committed to? Briefly state it below (e.g., \"I think we need stronger gun control.\")")

LOW_PROMPT = ("For the first task, we would like for you to think of an unimportant belief or attitude you have that is "
              "not something connected to your morals or something that you feel strongly committed to. These could be "
              "simple preferences or tastes that you hold for fun; this belief is different for different people but "
              "they could include things like the best song ever made, the best movie ever made, the best athlete to "
              "ever live, the ideal vacation destination, the best food ingredients, the best novel ever written, etc. "
              "What attitude or belief do you hold that you do not care deeply about or feel highly committed to? "
              "Briefly state it below (e.g., \"Michael Jordan is the best basketball player of all time.\")")

CHAT_INSTRUCTIONS = (
    "Thank you, you will now participate in a conversation with an AI chatbot about your attitude/belief. You are "
    "welcome to share your opinions, ask questions, debate the AI, or engage in any form of discussion as long as it "
    "remains centered on the attitude/belief.<br><br>Your participation is most useful if you engage with the AI as "
    "naturally as possible. After about 14 messages (7 from you and 7 from the chatbot), the chatbot will automatically "
    "move to the next page of the survey. Don't worry if this cuts off your conversation. Just keep chatting until the "
    "page advances.")

# (tag, pre-chat text, post-chat text, left label, right label)
ATTITUDE_ITEMS = [
    ("clarity", "How certain are you that you know what your true attitude/belief on this topic really is?",
     "After chatting with the AI, how certain are you that you know what your true attitude/belief on this topic really is?",
     "0<br>Not certain at all", "100<br>Very certain"),
    ("correct", "How certain are you that your attitude/belief toward the topic is the correct attitude to have?",
     "After chatting with the AI, how certain are you that your attitude/belief toward the topic is the correct attitude to have?",
     "0<br>Not certain at all", "100<br>Very certain"),
    ("importance", "How important is this attitude/belief to you personally?",
     "After chatting with the AI, how important is this attitude/belief to you personally?",
     "0<br>Not at all important", "100<br>Extremely important"),
    ("knowledge", "How knowledgeable are you about this attitude/belief?",
     "After chatting with the AI, how knowledgeable are you about this attitude/belief?",
     "0<br>Not at all knowledgeable", "100<br>Extremely knowledgeable"),
    ("commit", "How committed are you to this attitude/belief?",
     "After chatting with the AI, how committed are you to this attitude/belief?",
     "0<br>Not at all committed", "100<br>Extremely committed"),
]

AGREE6 = ["Strongly disagree", "Disagree", "Somewhat disagree", "Somewhat agree", "Agree", "Strongly agree"]

BOT_RATINGS = [
    "I enjoyed interacting with the AI chatbot.",
    "I want to interact with this AI chatbot again.",
    "The AI chatbot validated my perspective.",
    "The AI chatbot challenged my perspective.",
    "The AI chatbot both validated and challenged my perspective.",
]

# Item 7 was a duplicate "Trustworthy"; it is the attention check instead.
BOT_TRAITS = ["Trustworthy", "Capable", "Intelligent", "Confident", "Empathic", "Friendly",
              'Select "Somewhat agree"', "Biased", "Responsive", "Disagreeable"]

TP = "${e://Field/topic_phrase}"
IH_ITEMS = [
    "My views about %s are just as likely to be wrong as other views." % TP,
    "I recognize that my views about %s are based on limited evidence." % TP,
    "Although I have particular views about %s, I realize that I don't know everything that I need to know about it." % TP,
    "It is quite likely that there are gaps in my understanding about %s." % TP,
    "My sources for information about %s might not be the best." % TP,
    "I am open to new information in the area of %s that might change my view." % TP,
    "My views about %s today may someday turn out to be wrong." % TP,
    "When it comes to my views about %s I may be overlooking evidence." % TP,
    "My views about %s may change with additional evidence or information." % TP,
]

NFC_ITEMS = [
    "I would prefer complex to simple problems.",
    "I like to have the responsibility of handling a situation that requires a lot of thinking.",
    "Thinking is not my idea of fun.",
    "I would rather do something that requires little thought than something that is sure to challenge my thinking abilities.",
    "I try to anticipate and avoid situations where there is likely a chance I will have to think in depth about something.",
    "I find satisfaction in deliberating hard and for long hours.",
    "I only think as hard as I have to.",
    "I prefer to think about small, daily projects to long-term ones.",
    "I like tasks that require little thought once I've learned them.",
    "The idea of relying on thought to make my way to the top appeals to me.",
    "I really enjoy a task that involves coming up with new solutions to problems.",
    "Learning new ways to think doesn't excite me very much.",
    "I prefer my life to be filled with puzzles that I must solve.",
    "The notion of thinking abstractly is appealing to me.",
    "I would prefer a task that is intellectual, difficult, and important to one that is somewhat important but does not require much thought.",
    "I feel relief rather than satisfaction after completing a task that required a lot of mental effort.",
    "It's enough for me that something gets the job done; I don't care how or why it works.",
    "I usually end up deliberating about issues even when they do not personally affect me.",
]

# ---------------------------------------------------------------- builders
questions = []  # survey elements
_qid = [0]


def plain(html):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html)).strip()[:100]


def force():
    return {"Settings": {"ForceResponse": "ON", "ForceResponseType": "ON", "Type": "None"}}


def add(payload):
    _qid[0] += 1
    qid = "QID%d" % _qid[0]
    payload = dict(payload)
    payload.setdefault("DataVisibility", {"Private": False, "Hidden": False})
    payload.setdefault("Configuration", {"QuestionDescriptionOption": "UseText"})
    payload.setdefault("Language", [])
    payload.setdefault("GradingData", [])
    payload["QuestionID"] = qid
    payload["QuestionDescription"] = plain(payload["QuestionText"])
    questions.append({"SurveyID": SURVEY_ID, "Element": "SQ", "PrimaryAttribute": qid,
                      "SecondaryAttribute": payload["QuestionDescription"], "TertiaryAttribute": None,
                      "Payload": payload})
    return qid


def text(tag, html, js=None):
    p = {"QuestionText": html, "DataExportTag": tag, "QuestionType": "DB", "Selector": "TB",
         "ChoiceOrder": [], "Validation": {"Settings": {"Type": "None"}}, "NextChoiceId": 1, "NextAnswerId": 1}
    if js:
        p["QuestionJS"] = js
    return add(p)


def entry(tag, html, selector, max_chars, js=None):
    v = {"Settings": {"ForceResponse": "ON", "ForceResponseType": "ON", "Type": "TotalChar",
                      "MinChars": "1", "TotalChars": str(max_chars)}}
    p = {"QuestionText": html, "DataExportTag": tag, "QuestionType": "TE", "Selector": selector,
         "Validation": v, "NextChoiceId": 1, "NextAnswerId": 1, "SearchSource": {"AllowFreeResponse": "false"}}
    if js:
        p["QuestionJS"] = js
    return add(p)


def number(tag, html):
    v = {"Settings": {"ForceResponse": "ON", "ForceResponseType": "ON", "Type": "ContentType", "MinChars": "1",
                      "ContentType": "ValidNumber", "ValidNumber": {"Min": "", "Max": "", "NumDecimals": ""}}}
    return add({"QuestionText": html, "DataExportTag": tag, "QuestionType": "TE", "Selector": "SL",
                "Validation": v, "NextChoiceId": 1, "NextAnswerId": 1, "SearchSource": {"AllowFreeResponse": "false"}})


def choice(tag, html, options, text_entry=()):
    choices = {}
    for i, o in enumerate(options, 1):
        choices[str(i)] = {"Display": o}
        if i in text_entry:
            choices[str(i)]["TextEntry"] = "true"
    return add({"QuestionText": html, "DataExportTag": tag, "QuestionType": "MC", "Selector": "SAVR",
                "SubSelector": "TX", "Choices": choices, "ChoiceOrder": list(range(1, len(options) + 1)),
                "Validation": force(), "NextChoiceId": len(options) + 1, "NextAnswerId": 1})


def slider(tag, html, lo, hi, left, right):
    return add({
        "QuestionText": html, "DataExportTag": tag, "QuestionType": "Slider", "Selector": "HSLIDER",
        "Configuration": {"QuestionDescriptionOption": "UseText", "CSSliderMin": lo, "CSSliderMax": hi,
                          "GridLines": 10, "SnapToGrid": False, "NumDecimals": "0", "ShowValue": True,
                          "CustomStart": False, "NotApplicable": False, "MobileFirst": True},
        "Choices": {"1": {"Display": ""}}, "ChoiceOrder": ["1"],
        "Labels": {"1": {"Display": left}, "2": {"Display": right}},
        "Validation": force(), "NextChoiceId": 2, "NextAnswerId": 1})


def matrix(tag, html, items, answers, randomize=True):
    p = {"QuestionText": html, "DataExportTag": tag, "QuestionType": "Matrix", "Selector": "Likert",
         "SubSelector": "SingleAnswer",
         "Configuration": {"QuestionDescriptionOption": "UseText", "TextPosition": "inline", "ChoiceColumnWidth": 35,
                           "RepeatHeaders": "none", "WhiteSpace": "OFF", "MobileFirst": True},
         "Choices": {str(i): {"Display": t} for i, t in enumerate(items, 1)},
         "ChoiceOrder": list(range(1, len(items) + 1)),
         "Answers": {str(i): {"Display": a} for i, a in enumerate(answers, 1)},
         "AnswerOrder": list(range(1, len(answers) + 1)),
         "ChoiceDataExportTags": {str(i): "%s_%d" % (tag, i) for i in range(1, len(items) + 1)},
         "Validation": force(), "NextChoiceId": len(items) + 1, "NextAnswerId": len(answers) + 1}
    if randomize:
        p["Randomization"] = {"Advanced": None, "TotalRandSubset": "", "Type": "All"}
    return add(p)


def scale(n, left, right):
    return ["%s<br/>1" % left] + [str(i) for i in range(2, n)] + ["%s<br/>%d" % (right, n)]


blocks = []
_bl = [0]


def block(desc, *pages, kind="Standard"):
    _bl[0] += 1
    els = []
    for i, page in enumerate(pages):
        if i:
            els.append({"Type": "Page Break"})
        els += [{"Type": "Question", "QuestionID": q} for q in page]
    bid = "BL_evenHanded%04d" % _bl[0]
    blocks.append({"Type": kind, "SubType": "", "Description": desc, "ID": bid, "BlockElements": els})
    return bid


# ---------------------------------------------------------------- questions and blocks
B = {}
B["consent"] = block("Consent", [text("consent", "<strong>[CONSENT: paste your IRB-approved consent form here before launch.]</strong>")], kind="Default")
B["intro"] = block("Intro", [text("intro", INTRO)])

q_belief = entry("belief", "${e://Field/belief_prompt}", "SL", 200)
q_why = entry("belief_why",
              'Now, please briefly explain why you hold that belief.'
              '<span id="belief-src" style="display:none">${q://%s/ChoiceTextEntryValue}</span>' % q_belief,
              "ML", 500, js=PHRASE_JS)
B["belief"] = block("Belief", [q_belief], [q_why])


def attitude_block(desc, prefix, wrote, post):
    agree = slider(prefix + "_agree",
                   wrote + ' <strong>"${e://Field/topic}"</strong><br><br>How much do you agree with this statement right now?',
                   -50, 50, "-50<br>Strongly disagree", "+50<br>Strongly agree")
    rest = [slider("%s_%s" % (prefix, tag), post_t if post else pre_t, 0, 100, left, right)
            for tag, pre_t, post_t, left, right in ATTITUDE_ITEMS]
    return block(desc, [agree], rest)


B["pre"] = attitude_block("Pre-chat attitude", "pre", "You wrote:", False)

q_instr = text("chat_instructions", CHAT_INSTRUCTIONS)
q_chat = text("chat", CHAT_HTML, js=CHAT_JS)
B["chat"] = block("Chatbot conversation", [q_instr], [q_chat])

B["post"] = attitude_block("Post-chat attitude", "post", "Earlier, you wrote:", True)

q_tech = choice("tech", "Did you experience any technical difficulties regarding the chatbot?",
                ["No", "Yes (please describe)"], text_entry=(2,))
q_rate = matrix("bot_rating", "Thinking about the AI chatbot you just interacted with, please indicate your agreement with the following items.",
                BOT_RATINGS, ["%s<br/>%d" % (a, i) for i, a in enumerate(AGREE6, 1)])
q_trait = matrix("bot_trait", "To what extent do you think the AI chatbot you interacted with demonstrated the following characteristics?",
                 BOT_TRAITS, ["%s<br/>%d" % (a, i) for i, a in enumerate(AGREE6, 1)])
B["ratings"] = block("Chatbot ratings", [q_tech], [q_rate], [q_trait])

B["ih"] = block("Intellectual humility", [matrix(
    "ih", "Indicate how well or poorly each statement describes you and your views on your attitude/belief.",
    IH_ITEMS, scale(5, "Not at all like me", "Very much like me"))])
B["nfc"] = block("Need for cognition", [matrix(
    "nfc", "Indicate how much you agree with each item.", NFC_ITEMS, scale(5, "Strongly disagree", "Strongly agree"))])

B["demo"] = block("Demographics", [
    choice("sex", "Sex:", ["Male", "Female", "Non-binary"]),
    number("age", "Age:"),
    choice("ethnicity", "Ethnicity:", ["White", "Black or African American", "American Indian or Alaska Native",
                                       "Asian", "Native Hawaiian or Pacific Islander", "Other"]),
    choice("politics", "Political orientation:", ["Very liberal", "Liberal", "Slightly liberal", "Moderate",
                                                  "Slightly conservative", "Conservative", "Very conservative"]),
], [
    choice("ai_use", "How often do you use AI tools like ChatGPT, Claude, Gemini, etc.?",
           ["Multiple times a day", "Daily", "Multiple times a week", "Weekly", "Multiple times a month", "Monthly",
            "I rarely use AI tools"]),
    slider("ai_trust", "How much do you trust generative AI tools?", 1, 100, "1<br>Not at all", "100<br>Completely"),
])
B["debrief"] = block("Debriefing", [text("debrief", "<strong>[DEBRIEFING: paste your IRB-approved debriefing here before launch.]</strong>")])
blocks.append({"Type": "Trash", "Description": "Trash / Unused Questions", "ID": "BL_evenHandedTrash", "BlockElements": []})

# ---------------------------------------------------------------- survey flow
_fl = [1]


def fid():
    _fl[0] += 1
    return "FL_%d" % _fl[0]


def ed(fields, kind="Custom"):
    out = []
    for f, v in fields:
        e = {"Description": f, "Type": kind, "Field": f, "VariableType": "String", "DataVisibility": [], "AnalyzeText": False}
        if v is not None:
            e["Value"] = v
        out.append(e)
    return {"Type": "EmbeddedData", "FlowID": fid(), "EmbeddedData": out}


def std(bid):
    return {"Type": "Standard", "ID": bid, "FlowID": fid(), "Autofill": []}


def randomizer(groups):
    return {"Type": "BlockRandomizer", "FlowID": fid(), "SubSet": 1, "EvenPresentation": True,
            "Flow": [{"Type": "Group", "FlowID": fid(), "Description": name, "Flow": [ed(vals)]} for name, vals in groups]}


turn_fields = []
for prefix in ["support", "dissent", "stance", "direction", "parse_ok", "words", "error"]:
    turn_fields += ["%s_%d" % (prefix, i) for i in range(N_MESSAGES)]
declared = (["value_cond", "belief_prompt", "cond", "topic", "p_response", "topic_phrase", "topic_phrase_ok"]
            + ["msg_%d" % i for i in range(1, N_MESSAGES + 1)]
            + ["response_%d" % i for i in range(N_MESSAGES)] + turn_fields)

flow = [
    ed([("id", None)], kind="Recipient"),                     # SONA id from the survey link
    std(B["consent"]),
    ed([(f, None) for f in declared], kind="Recipient"),      # declared so the code can save them
    std(B["intro"]),
    randomizer([("High-value belief", [("value_cond", "high"), ("belief_prompt", HIGH_PROMPT)]),
                ("Low-value belief", [("value_cond", "low"), ("belief_prompt", LOW_PROMPT)])]),
    std(B["belief"]),
    ed([("topic", "${q://%s/ChoiceTextEntryValue}" % q_belief), ("p_response", "${q://%s/ChoiceTextEntryValue}" % q_why)]),
    std(B["pre"]),
    randomizer([("Balanced", [("cond", "balanced")]), ("Congenial", [("cond", "congenial")]),
                ("Uncongenial", [("cond", "uncongenial")])]),
    std(B["chat"]),
    std(B["post"]),
    std(B["ratings"]),
    std(B["ih"]),
    std(B["nfc"]),
    std(B["demo"]),
    std(B["debrief"]),
]

options = {
    "BackButton": "false", "SaveAndContinue": "true", "SurveyProtection": "PublicSurvey",
    "BallotBoxStuffingPrevention": "true", "NoIndex": "Yes", "SecureResponseFiles": "true",
    "SurveyExpiration": "None", "SurveyTermination": "DefaultMessage", "Header": "", "Footer": "",
    "ProgressBarDisplay": "None", "PartialData": "+1 week", "ValidationMessage": None, "PreviousButton": "",
    "NextButton": "", "SurveyTitle": "Qualtrics Survey | Qualtrics Experience Management",
    "NewScoring": 1, "EOSMessage": None, "ShowExportTags": "false", "CollectGeoLocation": "false",
    "PasswordProtection": "No", "AnonymizeResponse": "No", "RefererCheck": "No", "RecaptchaV3": "false",
    "ConfirmStart": False, "AutoConfirmStart": False, "RelevantID": "false", "ResponseSummary": "No",
    "EOSRedirectURL": None, "EmailThankYou": "false", "AvailableLanguages": {"EN": []},
    "ProtectSelectionIds": True, "CustomStyles": {"customCSS": CUSTOM_CSS},
}


def element(kind, primary, payload, secondary=None, tertiary=None):
    return {"SurveyID": SURVEY_ID, "Element": kind, "PrimaryAttribute": primary,
            "SecondaryAttribute": secondary, "TertiaryAttribute": tertiary, "Payload": payload}


survey = {
    "SurveyEntry": {
        "SurveyID": SURVEY_ID, "SurveyName": "Even-Handed Chatbot", "SurveyDescription": None,
        "SurveyOwnerID": "", "SurveyBrandID": "", "DivisionID": None, "SurveyLanguage": "EN",
        "SurveyActiveResponseSet": "RS_evenHanded01", "SurveyStatus": "Inactive",
        "SurveyStartDate": "0000-00-00 00:00:00", "SurveyExpirationDate": "0000-00-00 00:00:00",
        "SurveyCreationDate": "2026-10-30 00:00:00", "CreatorID": "", "LastModified": "2026-10-30 00:00:00",
        "LastAccessed": "0000-00-00 00:00:00", "LastActivated": "0000-00-00 00:00:00", "Deleted": None},
    "SurveyElements": [
        element("BL", "Survey Blocks", blocks),
        element("FL", "Survey Flow", {"Type": "Root", "FlowID": "FL_1", "Flow": flow, "Properties": {"Count": _fl[0]}}),
        element("PROJ", "CORE", {"ProjectCategory": "CORE", "SchemaVersion": "1.1.0"}, tertiary="1.1.0"),
        element("QC", "Survey Question Count", None, secondary=str(len(questions))),
        element("RS", "RS_evenHanded01", None),
        element("SCO", "Scoring", {"ScoringCategories": [], "ScoringCategoryGroups": [], "ScoringSummaryCategory": None,
                                   "ScoringSummaryAfterQuestions": 0, "ScoringSummaryAfterSurvey": 0,
                                   "DefaultScoringCategory": None, "AutoScoringCategory": None}),
        element("SO", "Survey Options", options),
        element("STAT", "Survey Statistics", {"MobileCompatible": True, "ID": "Survey Statistics"}),
    ] + questions,
}

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(survey, f, ensure_ascii=False)
print("wrote %s: %d questions, %d blocks" % (OUT, len(questions), len(blocks)))
