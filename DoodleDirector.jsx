import { useState, useRef, useEffect } from "react";

// ============================================================
// DOODLE DIRECTOR — Starter App
// A parent + toddler co-creation studio
// ============================================================

const COLORS = ["#FF6B6B", "#FFD93D", "#6BCB77", "#4D96FF", "#FF6BB5", "#C77DFF", "#FF9A3C"];
const BRUSH_SIZES = [8, 14, 22];

const CHOICE_STEPS = [
  {
    question: "Where does your character live? 🌍",
    choices: [
      { emoji: "🏔️", label: "A fluffy cloud castle" },
      { emoji: "🌊", label: "Under a rainbow sea" },
      { emoji: "🌲", label: "Inside a giant mushroom" },
    ],
  },
  {
    question: "What's their big problem today? 😮",
    choices: [
      { emoji: "🐉", label: "A friendly dragon is lost" },
      { emoji: "⭐", label: "All the stars fell down" },
      { emoji: "🍰", label: "Someone ate the moon cake" },
    ],
  },
  {
    question: "Who is their best friend? 💛",
    choices: [
      { emoji: "🦋", label: "A tiny talking butterfly" },
      { emoji: "🪨", label: "A wise old rock" },
      { emoji: "🌈", label: "A rainbow that can run" },
    ],
  },
];

// ── Inline styles / theme ────────────────────────────────────
const theme = {
  bg: "#FFF8EE",
  card: "#FFFDF7",
  primary: "#FF6B6B",
  accent: "#FFD93D",
  green: "#6BCB77",
  blue: "#4D96FF",
  purple: "#C77DFF",
  text: "#2D2A32",
  muted: "#9B8EA8",
  border: "#F0E6D3",
  shadow: "0 8px 32px rgba(45,42,50,0.10)",
  radius: "28px",
};

const globalStyle = `
  @import url('https://fonts.googleapis.com/css2?family=Baloo+2:wght@400;600;800&family=Nunito:wght@400;600;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: ${theme.bg}; font-family: 'Nunito', sans-serif; }
  button { cursor: pointer; border: none; outline: none; }

  @keyframes float {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-10px); }
  }
  @keyframes pop {
    0% { transform: scale(0.8); opacity: 0; }
    70% { transform: scale(1.05); }
    100% { transform: scale(1); opacity: 1; }
  }
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  @keyframes shimmer {
    0% { background-position: -200% center; }
    100% { background-position: 200% center; }
  }
  .float { animation: float 3s ease-in-out infinite; }
  .pop { animation: pop 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards; }
`;

// ── Tiny components ──────────────────────────────────────────

function Blob({ color, size, style }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: color, opacity: 0.12,
      position: "absolute", ...style,
      filter: "blur(40px)", pointerEvents: "none",
    }} />
  );
}

function BigButton({ children, onClick, color = theme.primary, textColor = "#fff", style = {} }) {
  const [pressed, setPressed] = useState(false);
  return (
    <button
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onTouchStart={() => setPressed(true)}
      onTouchEnd={() => setPressed(false)}
      onClick={onClick}
      style={{
        background: color,
        color: textColor,
        fontSize: "1.3rem",
        fontFamily: "'Baloo 2', cursive",
        fontWeight: 800,
        padding: "18px 36px",
        borderRadius: "100px",
        boxShadow: pressed ? "none" : `0 6px 0 ${color}99`,
        transform: pressed ? "translateY(4px)" : "translateY(0)",
        transition: "all 0.12s",
        letterSpacing: "0.02em",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function StepIndicator({ current, total }) {
  return (
    <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 24 }}>
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} style={{
          width: i === current ? 28 : 10, height: 10,
          borderRadius: 10,
          background: i === current ? theme.primary : theme.border,
          transition: "all 0.3s",
        }} />
      ))}
    </div>
  );
}

// ── SCREEN 1: Welcome ────────────────────────────────────────
function WelcomeScreen({ onStart }) {
  return (
    <div style={{ textAlign: "center", padding: "40px 24px", position: "relative", overflow: "hidden", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
      <Blob color={theme.primary} size={300} style={{ top: -80, left: -80 }} />
      <Blob color={theme.accent} size={250} style={{ bottom: -60, right: -60 }} />
      <Blob color={theme.purple} size={200} style={{ top: "40%", right: -40 }} />

      <div className="float" style={{ fontSize: "6rem", marginBottom: 8 }}>🎨</div>

      <h1 style={{
        fontFamily: "'Baloo 2', cursive",
        fontSize: "clamp(2.4rem, 8vw, 4rem)",
        fontWeight: 800,
        color: theme.text,
        lineHeight: 1.1,
        marginBottom: 12,
      }}>
        Doodle<br />
        <span style={{ color: theme.primary }}>Director</span>
      </h1>

      <p style={{
        fontSize: "1.15rem",
        color: theme.muted,
        fontWeight: 600,
        maxWidth: 320,
        margin: "0 auto 36px",
        lineHeight: 1.6,
      }}>
        Draw a character, make some choices, and watch your very own cartoon come to life! ✨
      </p>

      <BigButton onClick={onStart} color={theme.primary}>
        Let's Make a Show! 🎬
      </BigButton>

      <p style={{ marginTop: 20, fontSize: "0.85rem", color: theme.muted }}>
        For little creators aged 3–5 🌟
      </p>
    </div>
  );
}

// ── SCREEN 2: Doodle Canvas ──────────────────────────────────
function DoodleScreen({ onNext }) {
  const canvasRef = useRef(null);
  const [drawing, setDrawing] = useState(false);
  const [color, setColor] = useState(COLORS[0]);
  const [brushSize, setBrushSize] = useState(BRUSH_SIZES[1]);
  const [hasDrawn, setHasDrawn] = useState(false);
  const lastPos = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#FFFDF7";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  function getPos(e, canvas) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if (e.touches) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function startDraw(e) {
    e.preventDefault();
    setDrawing(true);
    setHasDrawn(true);
    const pos = getPos(e, canvasRef.current);
    lastPos.current = pos;
  }

  function draw(e) {
    e.preventDefault();
    if (!drawing) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = brushSize;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    lastPos.current = pos;
  }

  function stopDraw() { setDrawing(false); lastPos.current = null; }

  function clearCanvas() {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#FFFDF7";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  }

  function handleNext() {
    const dataUrl = canvasRef.current.toDataURL("image/png");
    onNext(dataUrl);
  }

  return (
    <div style={{ padding: "24px 16px", maxWidth: 540, margin: "0 auto" }}>
      <h2 style={{ fontFamily: "'Baloo 2', cursive", fontSize: "1.8rem", fontWeight: 800, color: theme.text, textAlign: "center", marginBottom: 4 }}>
        Draw your character! 🖍️
      </h2>
      <p style={{ textAlign: "center", color: theme.muted, fontWeight: 600, marginBottom: 20 }}>
        It can be anything — silly or serious!
      </p>

      {/* Canvas */}
      <div style={{ borderRadius: 24, overflow: "hidden", boxShadow: theme.shadow, border: `3px solid ${theme.border}`, marginBottom: 16 }}>
        <canvas
          ref={canvasRef}
          width={500}
          height={380}
          style={{ display: "block", width: "100%", touchAction: "none", cursor: "crosshair" }}
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={stopDraw}
          onMouseLeave={stopDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={stopDraw}
        />
      </div>

      {/* Color picker */}
      <div style={{ display: "flex", gap: 10, justifyContent: "center", marginBottom: 12, flexWrap: "wrap" }}>
        {COLORS.map(c => (
          <button
            key={c}
            onClick={() => setColor(c)}
            style={{
              width: 36, height: 36, borderRadius: "50%", background: c,
              border: color === c ? `3px solid ${theme.text}` : "3px solid transparent",
              transform: color === c ? "scale(1.2)" : "scale(1)",
              transition: "all 0.15s",
              boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
            }}
          />
        ))}
      </div>

      {/* Brush sizes */}
      <div style={{ display: "flex", gap: 12, justifyContent: "center", alignItems: "center", marginBottom: 24 }}>
        {BRUSH_SIZES.map(s => (
          <button
            key={s}
            onClick={() => setBrushSize(s)}
            style={{
              width: s + 16, height: s + 16, borderRadius: "50%",
              background: brushSize === s ? theme.text : theme.border,
              transition: "all 0.15s",
            }}
          />
        ))}
        <button onClick={clearCanvas} style={{ background: "none", color: theme.muted, fontFamily: "'Nunito', sans-serif", fontWeight: 700, fontSize: "0.9rem", padding: "6px 12px", borderRadius: 12, border: `2px solid ${theme.border}` }}>
          Clear 🗑️
        </button>
      </div>

      <div style={{ display: "flex", justifyContent: "center" }}>
        <BigButton onClick={handleNext} color={hasDrawn ? theme.green : theme.border} textColor={hasDrawn ? "#fff" : theme.muted}>
          {hasDrawn ? "My character is ready! →" : "Draw something first! ✏️"}
        </BigButton>
      </div>
    </div>
  );
}

// ── SCREEN 3: Name the character ─────────────────────────────
function NameScreen({ doodleUrl, onNext }) {
  const [name, setName] = useState("");
  const [listening, setListening] = useState(false);

  function startListening() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert("Voice not supported in this browser — try typing!"); return; }
    const r = new SR();
    r.lang = "en-US";
    r.onstart = () => setListening(true);
    r.onend = () => setListening(false);
    r.onresult = (e) => setName(e.results[0][0].transcript);
    r.start();
  }

  return (
    <div style={{ padding: "24px 16px", maxWidth: 540, margin: "0 auto", textAlign: "center" }}>
      <h2 style={{ fontFamily: "'Baloo 2', cursive", fontSize: "1.8rem", fontWeight: 800, color: theme.text, marginBottom: 8 }}>
        What's your character's name? ✨
      </h2>

      {/* Doodle preview */}
      <div style={{ width: 160, height: 160, borderRadius: 24, overflow: "hidden", margin: "0 auto 24px", border: `3px solid ${theme.border}`, boxShadow: theme.shadow }}>
        <img src={doodleUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="your character" />
      </div>

      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Type a name..."
        style={{
          fontSize: "1.6rem",
          fontFamily: "'Baloo 2', cursive",
          fontWeight: 800,
          textAlign: "center",
          padding: "14px 24px",
          borderRadius: "100px",
          border: `3px solid ${name ? theme.primary : theme.border}`,
          background: theme.card,
          color: theme.text,
          width: "100%",
          maxWidth: 320,
          outline: "none",
          marginBottom: 16,
          transition: "border 0.2s",
        }}
      />

      <div style={{ marginBottom: 28 }}>
        <button
          onClick={startListening}
          style={{
            background: listening ? theme.primary : theme.accent,
            color: theme.text,
            fontFamily: "'Baloo 2', cursive",
            fontWeight: 800,
            fontSize: "1.1rem",
            padding: "12px 28px",
            borderRadius: "100px",
            boxShadow: `0 4px 0 ${theme.accent}99`,
            animation: listening ? "spin 1s linear infinite" : "none",
            transition: "background 0.2s",
          }}
        >
          {listening ? "🎙️ Listening..." : "🎙️ Say the name!"}
        </button>
      </div>

      <BigButton
        onClick={() => onNext(name || "My Character")}
        color={theme.primary}
      >
        That's the name! →
      </BigButton>
    </div>
  );
}

// ── SCREEN 4: Story choices ──────────────────────────────────
function ChoicesScreen({ stepIndex, onChoice }) {
  const step = CHOICE_STEPS[stepIndex];
  const [selected, setSelected] = useState(null);

  function handleChoice(choice) {
    setSelected(choice.label);
    setTimeout(() => onChoice(choice.label), 400);
  }

  return (
    <div style={{ padding: "24px 16px", maxWidth: 540, margin: "0 auto", textAlign: "center" }}>
      <StepIndicator current={stepIndex} total={CHOICE_STEPS.length} />
      <h2 style={{ fontFamily: "'Baloo 2', cursive", fontSize: "1.7rem", fontWeight: 800, color: theme.text, marginBottom: 28, lineHeight: 1.3 }}>
        {step.question}
      </h2>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {step.choices.map((c) => (
          <button
            key={c.label}
            onClick={() => handleChoice(c)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              padding: "20px 24px",
              borderRadius: 20,
              background: selected === c.label ? theme.primary : theme.card,
              border: `3px solid ${selected === c.label ? theme.primary : theme.border}`,
              color: selected === c.label ? "#fff" : theme.text,
              fontFamily: "'Baloo 2', cursive",
              fontWeight: 700,
              fontSize: "1.15rem",
              textAlign: "left",
              boxShadow: theme.shadow,
              transform: selected === c.label ? "scale(1.03)" : "scale(1)",
              transition: "all 0.2s",
            }}
          >
            <span style={{ fontSize: "2.2rem" }}>{c.emoji}</span>
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── SCREEN 5: Generating ─────────────────────────────────────
function GeneratingScreen({ characterName, onDone }) {
  const messages = [
    "Waking up your character... 🌟",
    "Painting the world... 🎨",
    "Writing the story... 📖",
    "Adding some magic... ✨",
    "Almost ready... 🎬",
  ];
  const [msgIdx, setMsgIdx] = useState(0);
  const [episodeText, setEpisodeText] = useState("");
  const [error, setError] = useState(null);

  useEffect(() => {
    const interval = setInterval(() => setMsgIdx(i => (i + 1) % messages.length), 2200);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    generateEpisode();
  }, []);

  async function generateEpisode() {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: `You are a gentle, whimsical children's storyteller for toddlers aged 3-5. 
Write slow-paced, warm, imaginative stories with simple vocabulary. 
No scary elements. Lots of wonder and kindness.
Return ONLY a JSON object with these fields:
{ "title": "episode title", "story": "2-3 paragraph story", "moral": "one simple kind lesson" }
No markdown, no backticks, just raw JSON.`,
          messages: [{
            role: "user",
            content: `Write a short episode for a children's animated show. 
The main character is called "${characterName}".
Keep it gentle, whimsical, and under 150 words total.`
          }]
        })
      });

      const data = await response.json();
      const text = data.content?.map(b => b.text || "").join("") || "";
      const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
      setEpisodeText(parsed);
      setTimeout(() => onDone(parsed), 1000);
    } catch (err) {
      setError("Hmm, the story magic is resting. Try again!");
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center" }}>
      <div style={{ fontSize: "5rem", marginBottom: 24, animation: "float 2s ease-in-out infinite" }}>🎬</div>
      <h2 style={{ fontFamily: "'Baloo 2', cursive", fontSize: "1.8rem", fontWeight: 800, color: theme.text, marginBottom: 12 }}>
        Creating your episode!
      </h2>
      <p style={{ fontSize: "1.1rem", color: theme.primary, fontWeight: 700, minHeight: 32, transition: "opacity 0.4s" }}>
        {error || messages[msgIdx]}
      </p>
      {!error && (
        <div style={{ marginTop: 32, display: "flex", gap: 8 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: 12, height: 12, borderRadius: "50%",
              background: theme.primary,
              animation: `float ${0.8 + i * 0.2}s ease-in-out infinite`,
            }} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── SCREEN 6: Episode viewer ─────────────────────────────────
function EpisodeScreen({ episode, characterName, doodleUrl, onNewEpisode }) {
  return (
    <div style={{ padding: "24px 16px", maxWidth: 540, margin: "0 auto", textAlign: "center" }}>
      <div className="pop">
        <p style={{ fontSize: "0.85rem", fontWeight: 700, color: theme.primary, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>
          Episode 1
        </p>
        <h2 style={{ fontFamily: "'Baloo 2', cursive", fontSize: "1.8rem", fontWeight: 800, color: theme.text, marginBottom: 20, lineHeight: 1.2 }}>
          {episode.title}
        </h2>

        {/* Character card */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, background: theme.card, borderRadius: 20, padding: "16px 20px", marginBottom: 24, border: `3px solid ${theme.border}`, boxShadow: theme.shadow, textAlign: "left" }}>
          <div style={{ width: 72, height: 72, borderRadius: 16, overflow: "hidden", flexShrink: 0, border: `3px solid ${theme.accent}` }}>
            <img src={doodleUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt={characterName} />
          </div>
          <div>
            <p style={{ fontFamily: "'Baloo 2', cursive", fontWeight: 800, fontSize: "1.2rem", color: theme.text }}>{characterName}</p>
            <p style={{ fontSize: "0.85rem", color: theme.muted, fontWeight: 600 }}>Creative Director ⭐</p>
          </div>
        </div>

        {/* Story */}
        <div style={{ background: theme.card, borderRadius: 20, padding: "24px", marginBottom: 20, border: `3px solid ${theme.border}`, boxShadow: theme.shadow, textAlign: "left" }}>
          <p style={{ fontSize: "1.05rem", lineHeight: 1.8, color: theme.text, fontWeight: 600 }}>
            {episode.story}
          </p>
        </div>

        {/* Moral */}
        <div style={{ background: "#FFF3CD", borderRadius: 16, padding: "16px 20px", marginBottom: 28, border: `3px solid ${theme.accent}` }}>
          <p style={{ fontWeight: 800, color: theme.text, fontFamily: "'Baloo 2', cursive", fontSize: "1rem" }}>
            💛 Today's lesson: {episode.moral}
          </p>
        </div>

        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <BigButton onClick={onNewEpisode} color={theme.primary}>
            Make Episode 2! 🎉
          </BigButton>
        </div>
      </div>
    </div>
  );
}

// ── ROOT APP ─────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState("welcome");
  const [doodleUrl, setDoodleUrl] = useState(null);
  const [characterName, setCharacterName] = useState("");
  const [choices, setChoices] = useState([]);
  const [choiceStep, setChoiceStep] = useState(0);
  const [episode, setEpisode] = useState(null);

  function handleDoodle(url) { setDoodleUrl(url); setScreen("name"); }
  function handleName(n) { setCharacterName(n); setScreen("choices"); setChoiceStep(0); setChoices([]); }

  function handleChoice(choice) {
    const next = [...choices, choice];
    setChoices(next);
    if (choiceStep + 1 < CHOICE_STEPS.length) {
      setChoiceStep(choiceStep + 1);
    } else {
      setScreen("generating");
    }
  }

  function handleEpisodeDone(ep) { setEpisode(ep); setScreen("episode"); }
  function handleNewEpisode() { setChoices([]); setChoiceStep(0); setScreen("choices"); }

  return (
    <>
      <style>{globalStyle}</style>
      <div style={{ minHeight: "100vh", background: theme.bg, position: "relative" }}>
        {/* Decorative top bar */}
        <div style={{ height: 6, background: `linear-gradient(90deg, ${theme.primary}, ${theme.accent}, ${theme.green}, ${theme.blue}, ${theme.purple})` }} />

        {screen === "welcome" && <WelcomeScreen onStart={() => setScreen("doodle")} />}
        {screen === "doodle" && <DoodleScreen onNext={handleDoodle} />}
        {screen === "name" && <NameScreen doodleUrl={doodleUrl} onNext={handleName} />}
        {screen === "choices" && <ChoicesScreen stepIndex={choiceStep} onChoice={handleChoice} />}
        {screen === "generating" && <GeneratingScreen characterName={characterName} onDone={handleEpisodeDone} />}
        {screen === "episode" && <EpisodeScreen episode={episode} characterName={characterName} doodleUrl={doodleUrl} onNewEpisode={handleNewEpisode} />}
      </div>
    </>
  );
}
