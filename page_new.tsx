import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Arham Workspace — Business Email for Your Team",
  description: "Professional email on your own domain. Fast, secure, zero ads. 50% less than Zoho.",
};

export default function LandingPage() {
  return (
    <>
      <style>{`
        @keyframes fade-up  { from{opacity:0;transform:translateY(22px);} to{opacity:1;transform:translateY(0);} }
        @keyframes grad-flow { 0%,100%{background-position:0% 50%;} 50%{background-position:100% 50%;} }
        @keyframes badge-pulse { 0%,100%{box-shadow:0 0 10px rgba(220,38,38,0.3);} 50%{box-shadow:0 0 22px rgba(220,38,38,0.6);} }
        @keyframes dot-blink { 0%,100%{opacity:1;transform:scale(1);} 50%{opacity:0.4;transform:scale(0.7);} }
        @keyframes mockup-float { 0%,100%{transform:perspective(1200px) rotateX(5deg) rotateY(-2deg) translateY(0);} 50%{transform:perspective(1200px) rotateX(5deg) rotateY(-2deg) translateY(-10px);} }
        @keyframes row-in  { from{opacity:0;transform:translateX(-10px);} to{opacity:1;transform:translateX(0);} }
        @keyframes step-in { from{opacity:0;transform:translateY(12px);} to{opacity:1;transform:translateY(0);} }
        @keyframes line-grow { from{height:0;} to{height:100%;} }
        @keyframes shimmer  { to{background-position:200% center;} }
        @keyframes check-in { from{transform:scale(0) rotate(-45deg);opacity:0;} to{transform:scale(1) rotate(0);opacity:1;} }
        @keyframes table-in { from{opacity:0;transform:translateY(8px);} to{opacity:1;transform:translateY(0);} }
        @keyframes wave-bounce { 0%,100%{transform:scaleY(0.4);} 50%{transform:scaleY(1);} }
        .fu1{animation:fade-up .65s .0s ease forwards;opacity:0}
        .fu2{animation:fade-up .65s .1s ease forwards;opacity:0}
        .fu3{animation:fade-up .65s .2s ease forwards;opacity:0}
        .fu4{animation:fade-up .65s .3s ease forwards;opacity:0}
        .fu5{animation:fade-up .65s .4s ease forwards;opacity:0}
        .rtext{background:linear-gradient(135deg,#fca5a5 0%,#ef4444 40%,#dc2626 70%,#fbbf24 100%);background-size:200% 200%;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:grad-flow 5s ease infinite;}
        .cta-btn{display:inline-flex;align-items:center;gap:.6rem;padding:.95rem 2.2rem;border-radius:12px;background:linear-gradient(135deg,#dc2626,#991b1b);color:#fff;font-size:1rem;font-weight:700;text-decoration:none;transition:transform .15s,box-shadow .15s;box-shadow:0 6px 24px rgba(220,38,38,0.4);}
        .cta-btn:hover{transform:translateY(-3px);box-shadow:0 10px 36px rgba(220,38,38,0.6);}
        .ghost-btn{display:inline-flex;align-items:center;gap:.6rem;padding:.95rem 2.2rem;border-radius:12px;background:rgba(255,255,255,0.05);color:rgba(245,240,240,0.85);border:1px solid rgba(255,255,255,0.1);font-size:1rem;font-weight:600;text-decoration:none;transition:all .15s;}
        .ghost-btn:hover{background:rgba(255,255,255,0.09);border-color:rgba(220,38,38,0.3);transform:translateY(-2px);}
        .feat-card{background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.07);border-radius:16px;padding:1.5rem;transition:transform .25s cubic-bezier(.34,1.56,.64,1),border-color .25s,box-shadow .25s,background .25s;position:relative;overflow:hidden;cursor:default;}
        .feat-card::before{content:'';position:absolute;inset:0;border-radius:16px;background:linear-gradient(135deg,rgba(220,38,38,0.1),rgba(127,29,29,0.08));opacity:0;transition:opacity .3s;}
        .feat-card:hover{transform:translateY(-6px);border-color:rgba(220,38,38,0.35);box-shadow:0 16px 48px rgba(220,38,38,0.15);background:rgba(255,255,255,0.045);}
        .feat-card:hover::before{opacity:1;}
        .step-card{background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.07);border-radius:20px;padding:2rem;position:relative;overflow:hidden;transition:border-color .25s,box-shadow .25s;}
        .step-card:hover{border-color:rgba(220,38,38,0.3);box-shadow:0 12px 40px rgba(220,38,38,0.12);}
        .persona-card{background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.07);border-radius:20px;padding:1.75rem;transition:transform .25s cubic-bezier(.34,1.56,.64,1),border-color .25s,box-shadow .25s;}
        .persona-card:hover{transform:translateY(-5px);border-color:rgba(220,38,38,0.3);box-shadow:0 16px 40px rgba(220,38,38,0.12);}
        .sec-label{font-size:.72rem;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#ef4444;margin-bottom:.6rem;}
        .sec-title{font-size:clamp(1.8rem,3.5vw,2.5rem);font-weight:900;letter-spacing:-1.2px;color:#f5f0f0;margin-bottom:.75rem;}
        .sec-sub{color:#6b6060;max-width:440px;margin:0 auto;line-height:1.7;}
        .cmp-cell-yes{color:#4ade80;font-weight:700;font-size:1rem;}
        .cmp-cell-no{color:#6b6060;font-size:1rem;}
        .cmp-highlight{background:rgba(220,38,38,0.06);border-left:2px solid rgba(220,38,38,0.4);}
        .security-pill{display:inline-flex;align-items:center;gap:.5rem;padding:.4rem 1rem;border-radius:100px;font-size:.8rem;font-weight:600;transition:background .2s,border-color .2s;}
        .trust-badge{display:inline-flex;align-items:center;gap:.5rem;padding:.5rem 1rem;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);font-size:.8rem;color:#9ca3af;transition:border-color .2s;}
        .trust-badge:hover{border-color:rgba(220,38,38,0.25);color:#d1a0a0;}
        .mockup-wrap{animation:mockup-float 7s ease-in-out infinite;}
        .er1{animation:row-in .4s .5s ease forwards;opacity:0}
        .er2{animation:row-in .4s .65s ease forwards;opacity:0}
        .er3{animation:row-in .4s .8s ease forwards;opacity:0}
        .er4{animation:row-in .4s .95s ease forwards;opacity:0}
        .wave-bar{display:inline-block;width:4px;border-radius:2px;background:#4ade80;animation:wave-bounce 1.2s ease-in-out infinite;}
      `}</style>

      {/* ───────── 1. HERO ───────── */}
      <section style={{ textAlign:"center",padding:"clamp(5rem,12vw,9rem) clamp(1.5rem,5vw,4rem) clamp(3rem,5vw,4rem)" }}>
        <div className="fu1" style={{ marginBottom:"1.5rem" }}>
          <span style={{ display:"inline-flex",alignItems:"center",gap:".5rem",padding:".35rem 1rem",borderRadius:"100px",background:"rgba(220,38,38,0.1)",border:"1px solid rgba(220,38,38,0.25)",color:"#fca5a5",fontSize:".8rem",fontWeight:600,letterSpacing:".4px",animation:"badge-pulse 3s ease-in-out infinite" }}>
            <span style={{ width:"7px",height:"7px",borderRadius:"50%",background:"#ef4444",display:"inline-block",animation:"dot-blink 2s ease-in-out infinite" }}/>
            Business Email · 50% less than Zoho · Hosted in India
          </span>
        </div>

        <h1 className="fu2" style={{ fontSize:"clamp(3rem,6vw,5.5rem)",fontWeight:900,letterSpacing:"-2.5px",lineHeight:1.03,maxWidth:"740px",margin:"0 auto 1.5rem",color:"#f5f0f0" }}>
          Email that works as<br/>
          <span className="rtext">hard as you do</span>
        </h1>

        <p className="fu3" style={{ fontSize:"1.1rem",color:"#6b6060",maxWidth:"460px",margin:"0 auto 2.5rem",lineHeight:1.7 }}>
          Professional email on your own domain — clean webmail, team management, zero ads, zero tracking. Up in minutes.
        </p>

        <div className="fu4" style={{ display:"flex",alignItems:"center",justifyContent:"center",gap:"1rem",flexWrap:"wrap",marginBottom:"1rem" }}>
          <Link href="/signup" className="cta-btn">Start free trial →</Link>
          <Link href="/login" className="ghost-btn">Sign in</Link>
        </div>
        <p className="fu5" style={{ fontSize:".8rem",color:"#3d3030" }}>Free forever for up to 5 users ·{" "}
          <Link href="/pricing" style={{ color:"#ef4444",textDecoration:"none",fontWeight:500 }}>See all plans</Link>
        </p>
      </section>

      {/* ───────── 2. TRUST BAR ───────── */}
      <section style={{ padding:"0 clamp(1.5rem,5vw,4rem) clamp(3rem,5vw,4rem)",textAlign:"center" }}>
        <p style={{ fontSize:".75rem",color:"#3d3030",letterSpacing:"1.2px",textTransform:"uppercase",fontWeight:600,marginBottom:"1.25rem" }}>Powering email for businesses across India</p>
        <div style={{ display:"flex",alignItems:"center",justifyContent:"center",flexWrap:"wrap",gap:".75rem" }}>
          {["Arham Fintech","Arham Money","AlgoKosh","Arham One","Your Business Here"].map((name, i) => (
            <span key={name} className="trust-badge" style={{ opacity: i === 4 ? 0.45 : 1, fontStyle: i === 4 ? "italic" : "normal" }}>{name}</span>
          ))}
        </div>
      </section>

      {/* ───────── 3. STATS ───────── */}
      <div style={{ padding:"0 clamp(1.5rem,5vw,4rem) clamp(3rem,5vw,4rem)",maxWidth:"860px",margin:"0 auto" }}>
        <div style={{ display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"1px",background:"rgba(220,38,38,0.1)",borderRadius:"16px",overflow:"hidden",border:"1px solid rgba(220,38,38,0.12)" }}>
          {[
            ["99.9%","Uptime SLA"],
            ["< 2s","Mail delivery"],
            ["₹18","Per user / month"],
          ].map(([val,label],i) => (
            <div key={i} style={{ padding:"1.5rem",textAlign:"center",background:"rgba(6,0,10,0.8)",backdropFilter:"blur(12px)" }}>
              <div style={{ fontSize:"2rem",fontWeight:900,letterSpacing:"-1px",background:"linear-gradient(135deg,#fca5a5,#ef4444)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text" }}>{val}</div>
              <div style={{ fontSize:".73rem",color:"#4b4040",marginTop:".25rem",fontWeight:500,letterSpacing:".4px",textTransform:"uppercase" }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ───────── 4. BROWSER MOCKUP ───────── */}
      <div style={{ maxWidth:"860px",margin:"0 auto",padding:"0 clamp(1.5rem,5vw,2rem) clamp(4rem,8vw,6rem)" }}>
        <div className="mockup-wrap" style={{ borderRadius:"16px",overflow:"hidden",background:"rgba(10,0,6,0.95)",border:"1px solid rgba(220,38,38,0.15)",boxShadow:"0 40px 100px rgba(0,0,0,0.7),0 0 0 1px rgba(220,38,38,0.08),inset 0 1px 0 rgba(255,255,255,0.04)" }}>
          <div style={{ padding:".75rem 1.2rem",background:"rgba(255,255,255,0.02)",borderBottom:"1px solid rgba(255,255,255,0.05)",display:"flex",alignItems:"center",gap:".65rem" }}>
            <div style={{ display:"flex",gap:".4rem" }}>
              {["#ff5f57","#ffbd2e","#28c840"].map(c=><span key={c} style={{ width:"11px",height:"11px",borderRadius:"50%",background:c,display:"block" }}/>)}
            </div>
            <div style={{ flex:1,background:"rgba(255,255,255,0.04)",borderRadius:"6px",padding:".3rem .75rem",fontSize:".75rem",color:"#4b4040",fontFamily:"monospace",border:"1px solid rgba(255,255,255,0.05)" }}>
              🔒 inbox.arhamworkspace.tech
            </div>
          </div>
          <div style={{ display:"flex",minHeight:"340px" }}>
            <div style={{ width:"190px",flexShrink:0,padding:"1rem .75rem",borderRight:"1px solid rgba(255,255,255,0.05)",background:"rgba(255,255,255,0.01)" }}>
              {[{icon:"📥",label:"Inbox",count:4,active:true},{icon:"⭐",label:"Starred"},{icon:"📤",label:"Sent"},{icon:"📝",label:"Drafts"}].map(({icon,label,count,active})=>(
                <div key={label} style={{ display:"flex",alignItems:"center",gap:".55rem",padding:".5rem .65rem",borderRadius:"8px",marginBottom:".2rem",fontSize:".8rem",background:active?"rgba(220,38,38,0.12)":"transparent",color:active?"#fca5a5":"#4b4040",fontWeight:active?600:400 }}>
                  <span>{icon}</span><span style={{ flex:1 }}>{label}</span>
                  {count&&<span style={{ background:"#dc2626",color:"#fff",fontSize:".6rem",fontWeight:700,padding:".1rem .4rem",borderRadius:"100px" }}>{count}</span>}
                </div>
              ))}
            </div>
            <div style={{ flex:1,padding:".5rem 0" }}>
              {[
                { cls:"er1",init:"AK",color:"#dc2626",from:"Ankit Khatri",sub:"Q2 Sales Report — final numbers attached",time:"9:14 AM",unread:true },
                { cls:"er2",init:"PP",color:"#b91c1c",from:"Priya Patel",sub:"Re: New hire onboarding — start date confirmed",time:"8:47 AM",unread:true },
                { cls:"er3",init:"RJ",color:"#78350f",from:"Rahul Joshi",sub:"Design review notes from yesterday's call",time:"Yesterday",unread:false },
                { cls:"er4",init:"NM",color:"#7f1d1d",from:"Neha Mehta",sub:"Invoice #1042 — payment received",time:"Mon",unread:false },
              ].map(({cls,init,color,from,sub,time,unread})=>(
                <div key={from} className={cls} style={{ display:"flex",alignItems:"flex-start",gap:".75rem",padding:".7rem 1rem",borderBottom:"1px solid rgba(255,255,255,0.03)",background:unread?"rgba(220,38,38,0.04)":"transparent" }}>
                  <div style={{ width:"32px",height:"32px",borderRadius:"50%",background:color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:".7rem",fontWeight:800,color:"#fff",flexShrink:0 }}>{init}</div>
                  <div style={{ flex:1,minWidth:0 }}>
                    <div style={{ fontSize:".8rem",color:unread?"#f5f0f0":"#4b4040",fontWeight:unread?700:400 }}>{from}</div>
                    <div style={{ fontSize:".83rem",color:unread?"#d1a0a0":"#3d3030",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>{sub}</div>
                  </div>
                  <div style={{ fontSize:".7rem",color:"#3d3030",flexShrink:0,marginTop:".15rem" }}>{time}</div>
                  {unread&&<div style={{ width:"7px",height:"7px",borderRadius:"50%",background:"#ef4444",flexShrink:0,marginTop:".5rem",animation:"dot-blink 2s ease-in-out infinite" }}/>}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div style={{ display:"flex",justifyContent:"center",gap:"1rem",marginTop:"1.5rem",flexWrap:"wrap" }}>
          {[
            {icon:"🔒",label:"End-to-end secure",c:"rgba(220,38,38,0.12)",b:"rgba(220,38,38,0.2)",t:"#fca5a5"},
            {icon:"⚡",label:"< 2s delivery",c:"rgba(251,191,36,0.1)",b:"rgba(251,191,36,0.2)",t:"#fcd34d"},
            {icon:"🇮🇳",label:"India-hosted",c:"rgba(34,197,94,0.1)",b:"rgba(34,197,94,0.2)",t:"#86efac"},
          ].map(({icon,label,c,b,t})=>(
            <span key={label} style={{ display:"inline-flex",alignItems:"center",gap:".4rem",padding:".4rem .9rem",borderRadius:"100px",background:c,border:`1px solid ${b}`,color:t,fontSize:".78rem",fontWeight:600 }}>
              {icon} {label}
            </span>
          ))}
        </div>
      </div>

      {/* ───────── 5. HOW IT WORKS ───────── */}
      <section style={{ maxWidth:"1000px",margin:"0 auto",padding:"0 clamp(1.5rem,5vw,2rem) clamp(4rem,8vw,6rem)" }}>
        <div style={{ textAlign:"center",marginBottom:"3.5rem" }}>
          <div className="sec-label">How it works</div>
          <h2 className="sec-title">Up and running in 3 steps</h2>
          <p className="sec-sub">No IT team needed. If you can edit a DNS record, you can run your own business email.</p>
        </div>

        <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:"1.5rem",position:"relative" }}>
          {[
            { num:"01",title:"Sign up with your email",desc:"Enter your work email (e.g. chirag@yourcompany.com). We create your admin account instantly — no guesswork, the address you type is what you get.",icon:"✉️",color:"#dc2626" },
            { num:"02",title:"Add 4 DNS records",desc:"We show you the exact MX, SPF, DKIM, and DMARC records to paste into GoDaddy, Namecheap, Cloudflare — wherever your domain lives.",icon:"🔧",color:"#b91c1c" },
            { num:"03",title:"Start sending",desc:"Once DNS propagates (minutes to hours), your email is live. Add your team, import from Zoho or Google, and manage everything from the dashboard.",icon:"🚀",color:"#991b1b" },
          ].map(({num,title,desc,icon,color},i)=>(
            <div key={num} className="step-card" style={{ animation:`step-in 0.55s ${0.1*i}s ease forwards`,opacity:0 }}>
              <div style={{ display:"flex",alignItems:"center",gap:"1rem",marginBottom:"1.25rem" }}>
                <div style={{ width:"44px",height:"44px",borderRadius:"12px",background:`linear-gradient(135deg,${color},rgba(127,29,29,0.5))`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1.3rem",flexShrink:0,boxShadow:`0 4px 16px rgba(220,38,38,0.25)` }}>{icon}</div>
                <span style={{ fontSize:"2.5rem",fontWeight:900,color:"rgba(220,38,38,0.15)",letterSpacing:"-2px",lineHeight:1,fontFamily:"monospace" }}>{num}</span>
              </div>
              <h3 style={{ fontSize:".98rem",fontWeight:700,color:"#f5f0f0",marginBottom:".5rem" }}>{title}</h3>
              <p style={{ fontSize:".84rem",color:"#6b6060",lineHeight:1.65 }}>{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ───────── 6. FEATURES ───────── */}
      <section style={{ maxWidth:"1000px",margin:"0 auto",padding:"0 clamp(1.5rem,5vw,2rem) clamp(4rem,8vw,6rem)" }}>
        <div style={{ textAlign:"center",marginBottom:"3rem" }}>
          <div className="sec-label">What&apos;s included</div>
          <h2 className="sec-title">Everything your team needs</h2>
          <p className="sec-sub">No bloat. No hidden limits. Just fast, reliable email that works the moment you set it up.</p>
        </div>
        <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:"1rem" }}>
          {[
            {icon:"🏷️",title:"Your Own Domain",desc:"Send as you@yourbusiness.com — professional from day one. Bring any domain you already own.",grad:"135deg,rgba(220,38,38,0.6),rgba(127,29,29,0.5)"},
            {icon:"🔐",title:"SPF · DKIM · DMARC",desc:"Authentication set up automatically. Land in inboxes, not spam folders, from day one.",grad:"135deg,rgba(185,28,28,0.6),rgba(220,38,38,0.4)"},
            {icon:"📱",title:"Any Email Client",desc:"Works with Outlook, Apple Mail, Thunderbird — full IMAP/SMTP. Your team uses what they know.",grad:"135deg,rgba(153,27,27,0.6),rgba(185,28,28,0.5)"},
            {icon:"👥",title:"Team Management",desc:"Add/remove users, reset passwords, bulk import from Google or Zoho — all in one place.",grad:"135deg,rgba(127,29,29,0.6),rgba(153,27,27,0.5)"},
            {icon:"🔇",title:"Zero Ads. Zero Tracking.",desc:"Your inbox belongs to you. We never read your email, never sell your data, never serve ads.",grad:"135deg,rgba(239,68,68,0.5),rgba(185,28,28,0.6)"},
            {icon:"🇮🇳",title:"Data Stays in India",desc:"Servers in India. Fast latency from metros, PDPA-aligned, no cross-border data issues.",grad:"135deg,rgba(220,38,38,0.5),rgba(127,29,29,0.5)"},
          ].map(({icon,title,desc,grad},i)=>(
            <div key={title} className="feat-card" style={{ animation:`fade-up 0.55s ${0.08*i}s ease forwards`,opacity:0 }}>
              <div style={{ position:"relative",zIndex:1 }}>
                <div style={{ width:"44px",height:"44px",borderRadius:"12px",background:`linear-gradient(${grad})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1.25rem",marginBottom:".9rem",boxShadow:"0 4px 16px rgba(220,38,38,0.2)" }}>{icon}</div>
                <h3 style={{ fontSize:".95rem",fontWeight:700,color:"#f5f0f0",marginBottom:".4rem" }}>{title}</h3>
                <p style={{ fontSize:".84rem",color:"#6b6060",lineHeight:1.62 }}>{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ───────── 7. WHO IT'S FOR ───────── */}
      <section style={{ maxWidth:"1000px",margin:"0 auto",padding:"0 clamp(1.5rem,5vw,2rem) clamp(4rem,8vw,6rem)" }}>
        <div style={{ textAlign:"center",marginBottom:"3rem" }}>
          <div className="sec-label">Use cases</div>
          <h2 className="sec-title">Built for every kind of team</h2>
          <p className="sec-sub">From solo founders to growing companies, Arham Workspace fits how you actually work.</p>
        </div>
        <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:"1.25rem" }}>
          {[
            { emoji:"🚀",label:"Startups & Founders",title:"Look professional from day one",desc:"Get a real @yourcompany.com email instead of a Gmail. Takes minutes to set up, free for 5 people forever.",pills:["Free tier","Custom domain","5 min setup"] },
            { emoji:"🏢",label:"SMEs & Agencies",title:"One place to manage your whole team",desc:"Add employees, reset passwords, manage billing — without touching a server or calling IT support.",pills:["Team management","Bulk import","Admin console"] },
            { emoji:"🔄",label:"Migrating from Zoho/Google",title:"Switch without losing a single email",desc:"Import your entire team from a CSV export. All accounts, all aliases — at half the price, zero lock-in.",pills:["CSV import","Email migration","50% cheaper"] },
          ].map(({emoji,label,title,desc,pills})=>(
            <div key={title} className="persona-card">
              <div style={{ fontSize:"2rem",marginBottom:".85rem" }}>{emoji}</div>
              <p style={{ fontSize:".72rem",fontWeight:700,color:"#ef4444",letterSpacing:"1px",textTransform:"uppercase",marginBottom:".4rem" }}>{label}</p>
              <h3 style={{ fontSize:"1rem",fontWeight:700,color:"#f5f0f0",marginBottom:".6rem",lineHeight:1.35 }}>{title}</h3>
              <p style={{ fontSize:".84rem",color:"#6b6060",lineHeight:1.65,marginBottom:"1rem" }}>{desc}</p>
              <div style={{ display:"flex",gap:".5rem",flexWrap:"wrap" }}>
                {pills.map(p=>(
                  <span key={p} style={{ fontSize:".72rem",fontWeight:600,padding:".25rem .6rem",borderRadius:"100px",background:"rgba(220,38,38,0.1)",border:"1px solid rgba(220,38,38,0.2)",color:"#fca5a5" }}>{p}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ───────── 8. SECURITY ───────── */}
      <section style={{ maxWidth:"1000px",margin:"0 auto",padding:"0 clamp(1.5rem,5vw,2rem) clamp(4rem,8vw,6rem)" }}>
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:"3rem",alignItems:"center" }}>
          <div>
            <div className="sec-label">Security</div>
            <h2 className="sec-title" style={{ textAlign:"left",margin:"0 0 .75rem" }}>Enterprise-grade security. Out of the box.</h2>
            <p style={{ color:"#6b6060",lineHeight:1.7,marginBottom:"2rem" }}>
              We set up authentication records automatically when you verify your domain. No hunting through docs, no manual configuration.
            </p>
            <div style={{ display:"flex",flexDirection:"column",gap:".75rem" }}>
              {[
                {pill:"SPF",label:"Sender Policy Framework",desc:"Prevents anyone from spoofing your domain in email headers.",color:"#dc2626"},
                {pill:"DKIM",label:"DomainKeys Identified Mail",desc:"Cryptographic signature proves mail originated from your server.",color:"#b91c1c"},
                {pill:"DMARC",label:"Domain-based Message Auth",desc:"Tells receivers what to do with mail that fails SPF or DKIM.",color:"#991b1b"},
                {pill:"TLS",label:"Transport Layer Security",desc:"All mail in transit is encrypted. Always on, no config needed.",color:"#7f1d1d"},
              ].map(({pill,label,desc,color})=>(
                <div key={pill} style={{ display:"flex",gap:"1rem",alignItems:"flex-start" }}>
                  <span className="security-pill" style={{ background:`rgba(${color === "#dc2626" ? "220,38,38" : color === "#b91c1c" ? "185,28,28" : color === "#991b1b" ? "153,27,27" : "127,29,29"},0.15)`,border:`1px solid rgba(220,38,38,0.2)`,color:"#fca5a5",flexShrink:0,marginTop:".1rem" }}>{pill}</span>
                  <div>
                    <p style={{ fontSize:".84rem",fontWeight:600,color:"#f5f0f0",marginBottom:".2rem" }}>{label}</p>
                    <p style={{ fontSize:".78rem",color:"#6b6060",lineHeight:1.55 }}>{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ background:"rgba(255,255,255,0.02)",border:"1px solid rgba(220,38,38,0.12)",borderRadius:"20px",padding:"2rem" }}>
            <p style={{ fontSize:".75rem",fontWeight:700,letterSpacing:"1px",textTransform:"uppercase",color:"#4b4040",marginBottom:"1.25rem" }}>Email authentication status</p>
            {[
              {type:"MX",value:"mail.arhamworkspace.tech",status:"Active"},
              {type:"SPF",value:"v=spf1 include:arhamworkspace.tech ~all",status:"Active"},
              {type:"DKIM",value:"v=DKIM1; k=ed25519; p=...",status:"Active"},
              {type:"DMARC",value:"v=DMARC1; p=none; rua=...",status:"Active"},
            ].map(({type,value,status},i)=>(
              <div key={type} style={{ display:"flex",alignItems:"center",gap:".75rem",padding:".75rem 0",borderBottom:i<3?"1px solid rgba(255,255,255,0.04)":"none",animation:`check-in 0.3s ${0.1*i}s ease forwards`,opacity:0 }}>
                <span style={{ fontSize:".65rem",fontWeight:700,background:"rgba(220,38,38,0.12)",color:"#fca5a5",padding:".2rem .5rem",borderRadius:"5px",fontFamily:"monospace",flexShrink:0 }}>{type}</span>
                <span style={{ flex:1,fontSize:".75rem",color:"#4b4040",fontFamily:"monospace",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{value}</span>
                <span style={{ fontSize:".7rem",fontWeight:700,color:"#4ade80",flexShrink:0 }}>✓ {status}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ───────── 9. COMPARISON TABLE ───────── */}
      <section style={{ maxWidth:"860px",margin:"0 auto",padding:"0 clamp(1.5rem,5vw,2rem) clamp(4rem,8vw,6rem)" }}>
        <div style={{ textAlign:"center",marginBottom:"3rem" }}>
          <div className="sec-label">Comparison</div>
          <h2 className="sec-title">How we compare</h2>
        </div>
        <div style={{ background:"rgba(255,255,255,0.02)",border:"1px solid rgba(220,38,38,0.1)",borderRadius:"20px",overflow:"hidden" }}>
          {/* Table header */}
          <div style={{ display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr",gap:0 }}>
            <div style={{ padding:"1rem 1.5rem",fontSize:".78rem",fontWeight:600,color:"#4b4040",textTransform:"uppercase",letterSpacing:".8px",borderBottom:"1px solid rgba(255,255,255,0.05)" }} />
            {[{name:"Arham",highlight:true},{name:"Zoho Mail"},{name:"Google WS"}].map(({name,highlight})=>(
              <div key={name} style={{ padding:"1rem .75rem",textAlign:"center",fontSize:".82rem",fontWeight:700,color:highlight?"#fca5a5":"#6b6060",borderBottom:"1px solid rgba(255,255,255,0.05)",background:highlight?"rgba(220,38,38,0.06)":"transparent",borderLeft:highlight?"2px solid rgba(220,38,38,0.3)":"none" }}>{name}</div>
            ))}
          </div>
          {[
            {label:"Price / user / month",vals:["₹18","₹35","₹135"],highlight:true},
            {label:"Free plan (forever)",vals:["✓ 5 users","✗ No","✗ No"],highlight:false},
            {label:"Custom domain",vals:["✓","✓","✓"],highlight:false},
            {label:"IMAP / SMTP",vals:["✓ All plans","✓ Paid only","✓ Paid only"],highlight:false},
            {label:"Data stored in India",vals:["✓ Always","~ Optional","✗ No"],highlight:false},
            {label:"Import from Zoho/Google",vals:["✓ Built-in","✗ No","✗ No"],highlight:true},
            {label:"Zero tracking / ads",vals:["✓ Always","✓","✗ Ads in free"],highlight:false},
          ].map(({label,vals,highlight},i)=>(
            <div key={label} style={{ display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr",borderBottom:i<6?"1px solid rgba(255,255,255,0.04)":"none",background:highlight?"rgba(220,38,38,0.03)":"transparent",animation:`table-in 0.4s ${0.05*i}s ease forwards`,opacity:0 }}>
              <div style={{ padding:".85rem 1.5rem",fontSize:".83rem",color:"#9ca3af" }}>{label}</div>
              {vals.map((v,j)=>(
                <div key={j} style={{ padding:".85rem .75rem",textAlign:"center",fontSize:".82rem",fontWeight:600,background:j===0?"rgba(220,38,38,0.04)":"transparent",borderLeft:j===0?"2px solid rgba(220,38,38,0.25)":"none",color:v.startsWith("✓")?"#4ade80":v.startsWith("✗")?"#6b6060":"#d1a0a0" }}>{v}</div>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* ───────── 10. AI — LIVE NOW ───────── */}
      <section style={{ maxWidth:"1100px",margin:"0 auto",padding:"0 clamp(1.5rem,5vw,2rem) clamp(4rem,8vw,6rem)" }}>
        <div style={{ textAlign:"center",marginBottom:"3.5rem" }}>
          <div style={{ display:"inline-flex",alignItems:"center",gap:".5rem",padding:".35rem 1rem",borderRadius:"100px",background:"rgba(34,197,94,0.1)",border:"1px solid rgba(34,197,94,0.3)",color:"#4ade80",fontSize:".78rem",fontWeight:700,letterSpacing:"1px",marginBottom:"1.25rem" }}>
            <span style={{ width:"8px",height:"8px",borderRadius:"50%",background:"#4ade80",display:"inline-block",animation:"dot-blink 2s ease-in-out infinite" }}/>
            LIVE NOW
          </div>
          <h2 className="sec-title" style={{ fontSize:"clamp(2rem,4vw,3rem)" }}>
            Your inbox. Now with a brain.<br/>
            <span className="rtext">Built in, not bolted on.</span>
          </h2>
          <p className="sec-sub" style={{ maxWidth:"520px" }}>
            Arham Workspace ships with AI built into the composer — not an add-on, not locked behind enterprise. Every user, day one.
          </p>
        </div>

        {/* AI Drafts — Hero Card */}
        <div style={{ background:"rgba(255,255,255,0.025)",border:"1px solid rgba(220,38,38,0.2)",borderRadius:"20px",padding:"2rem",marginBottom:"1.5rem",boxShadow:"0 8px 40px rgba(220,38,38,0.08)" }}>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:"2.5rem",alignItems:"start" }}>
            {/* Left */}
            <div>
              <p style={{ fontSize:".72rem",fontWeight:700,letterSpacing:"1.5px",textTransform:"uppercase",color:"#ef4444",marginBottom:".75rem" }}>✦ AI DRAFTS</p>
              <h3 style={{ fontSize:"clamp(1.4rem,2.5vw,1.9rem)",fontWeight:900,letterSpacing:"-1px",color:"#f5f0f0",lineHeight:1.15,marginBottom:"1rem" }}>
                Write once.<br/>Get 3 versions.<br/>Pick the best.
              </h3>
              <p style={{ fontSize:".88rem",color:"#6b6060",lineHeight:1.7,marginBottom:"1.5rem" }}>
                Type your message once and Arham AI instantly generates three tonal variations. No prompting, no copying, no context switching — just pick and send.
              </p>
              <div style={{ display:"flex",flexDirection:"column",gap:".6rem" }}>
                {["Professional — polished and formal","Friendly — warm and approachable","Brief — three sentences, done"].map((item)=>(
                  <div key={item} style={{ display:"flex",alignItems:"center",gap:".75rem" }}>
                    <div style={{ width:"20px",height:"20px",borderRadius:"50%",background:"rgba(220,38,38,0.15)",border:"1px solid rgba(220,38,38,0.3)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}>
                      <span style={{ color:"#ef4444",fontSize:".7rem",fontWeight:700 }}>✓</span>
                    </div>
                    <span style={{ fontSize:".84rem",color:"#d1a0a0" }}>{item}</span>
                  </div>
                ))}
              </div>
            </div>
            {/* Right — Draft Cards Preview */}
            <div style={{ background:"rgba(6,0,10,0.8)",borderRadius:"14px",border:"1px solid rgba(255,255,255,0.06)",padding:"1.25rem",display:"flex",flexDirection:"column",gap:".75rem" }}>
              <p style={{ fontSize:".7rem",fontWeight:700,letterSpacing:"1px",textTransform:"uppercase",color:"#4b4040",marginBottom:".25rem" }}>✦ AI generated 3 drafts</p>
              {[
                { tone:"Professional", text:"Dear Rahul, I wanted to follow up regarding the Q3 budget proposal. Could we schedule a brief call to align on the key deliverables?", selected:false },
                { tone:"Friendly", text:"Hey Rahul! Just checking in on the Q3 budget — would love to jump on a quick call and sort out the details together. Works for you?", selected:true },
                { tone:"Brief", text:"Hi Rahul, Q3 budget follow-up. Free for a quick call this week?", selected:false },
              ].map(({tone, text, selected})=>(
                <div key={tone} style={{ background:selected?"rgba(220,38,38,0.08)":"rgba(255,255,255,0.02)",border:selected?"1px solid rgba(220,38,38,0.35)":"1px solid rgba(255,255,255,0.05)",borderRadius:"10px",padding:".85rem",position:"relative" }}>
                  <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:".4rem" }}>
                    <span style={{ fontSize:".68rem",fontWeight:700,color:selected?"#fca5a5":"#4b4040",letterSpacing:".5px",textTransform:"uppercase" }}>{tone}</span>
                    {selected && <span style={{ fontSize:".62rem",fontWeight:700,background:"rgba(220,38,38,0.2)",color:"#fca5a5",padding:".15rem .5rem",borderRadius:"100px",border:"1px solid rgba(220,38,38,0.3)" }}>SELECTED</span>}
                  </div>
                  <p style={{ fontSize:".78rem",color:selected?"#e5d0d0":"#4b4040",lineHeight:1.55,margin:0 }}>{text}</p>
                </div>
              ))}
              <div style={{ display:"flex",gap:".75rem",marginTop:".25rem" }}>
                <button style={{ flex:1,padding:".55rem",borderRadius:"8px",background:"linear-gradient(135deg,#dc2626,#991b1b)",color:"#fff",fontSize:".78rem",fontWeight:700,border:"none",cursor:"pointer" }}>Use this draft</button>
                <button style={{ flex:1,padding:".55rem",borderRadius:"8px",background:"rgba(255,255,255,0.05)",color:"#9ca3af",fontSize:".78rem",fontWeight:600,border:"1px solid rgba(255,255,255,0.08)",cursor:"pointer" }}>Regenerate</button>
              </div>
            </div>
          </div>
        </div>

        {/* Voice-to-Email + AI Spam — Side by Side */}
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:"1.25rem" }}>
          {/* Voice-to-Email */}
          <div className="feat-card">
            <div style={{ position:"relative",zIndex:1 }}>
              <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1rem" }}>
                <div style={{ width:"44px",height:"44px",borderRadius:"12px",background:"linear-gradient(135deg,rgba(34,197,94,0.3),rgba(16,185,129,0.2))",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1.3rem",border:"1px solid rgba(34,197,94,0.2)" }}>🎙️</div>
                <span style={{ fontSize:".65rem",fontWeight:700,background:"rgba(34,197,94,0.12)",color:"#4ade80",padding:".25rem .7rem",borderRadius:"100px",border:"1px solid rgba(34,197,94,0.25)",letterSpacing:".5px" }}>LIVE NOW</span>
              </div>
              <h3 style={{ fontSize:"1rem",fontWeight:700,color:"#f5f0f0",marginBottom:".5rem" }}>Voice-to-Email</h3>
              <p style={{ fontSize:".84rem",color:"#6b6060",lineHeight:1.62,marginBottom:"1.25rem" }}>
                Tap the mic, speak naturally, and Arham AI transcribes and formats your email in seconds. Perfect 30-second emails — hands-free.
              </p>
              {/* Animated waveform */}
              <div style={{ display:"flex",alignItems:"center",justifyContent:"center",gap:"3px",height:"36px",background:"rgba(34,197,94,0.05)",borderRadius:"8px",border:"1px solid rgba(34,197,94,0.1)",padding:"0 1rem" }}>
                {[14,22,10,30,18,26,8,20,16,28,12,24,10,20,16].map((h,i)=>(
                  <div key={i} className="wave-bar" style={{ height:`${h}px`,animationDelay:`${i*0.08}s` }}/>
                ))}
              </div>
              <p style={{ fontSize:".7rem",color:"#4ade80",textAlign:"center",marginTop:".5rem",letterSpacing:".3px" }}>● Recording… 0:12</p>
            </div>
          </div>

          {/* AI Spam Intelligence */}
          <div className="feat-card">
            <div style={{ position:"relative",zIndex:1 }}>
              <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1rem" }}>
                <div style={{ width:"44px",height:"44px",borderRadius:"12px",background:"linear-gradient(135deg,rgba(220,38,38,0.3),rgba(127,29,29,0.2))",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1.3rem",border:"1px solid rgba(220,38,38,0.2)" }}>🛡️</div>
                <span style={{ fontSize:".65rem",fontWeight:700,background:"rgba(34,197,94,0.12)",color:"#4ade80",padding:".25rem .7rem",borderRadius:"100px",border:"1px solid rgba(34,197,94,0.25)",letterSpacing:".5px" }}>LIVE NOW</span>
              </div>
              <h3 style={{ fontSize:"1rem",fontWeight:700,color:"#f5f0f0",marginBottom:".5rem" }}>AI Spam Intelligence</h3>
              <p style={{ fontSize:".84rem",color:"#6b6060",lineHeight:1.62,marginBottom:"1.25rem" }}>
                Goes beyond keyword filters. Catches CEO fraud, targeted phishing, and social engineering before it reaches your team.
              </p>
              <div style={{ display:"flex",flexDirection:"column",gap:".5rem" }}>
                {[
                  { from:"ceo.impersonator@g00gle-corp.com", sub:"Urgent wire transfer needed", threat:"CEO Fraud" },
                  { from:"hr-payroll@arhamfintech-secure.net", sub:"Update your bank details now", threat:"Phishing" },
                ].map(({from, sub, threat})=>(
                  <div key={threat} style={{ display:"flex",alignItems:"center",gap:".6rem",background:"rgba(220,38,38,0.06)",border:"1px solid rgba(220,38,38,0.15)",borderRadius:"8px",padding:".6rem .8rem" }}>
                    <span style={{ fontSize:".9rem" }}>🚫</span>
                    <div style={{ flex:1,minWidth:0 }}>
                      <p style={{ fontSize:".68rem",color:"#6b6060",margin:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{from}</p>
                      <p style={{ fontSize:".72rem",color:"#d1a0a0",margin:0,fontWeight:600 }}>{sub}</p>
                    </div>
                    <span style={{ fontSize:".6rem",fontWeight:700,background:"rgba(220,38,38,0.15)",color:"#fca5a5",padding:".2rem .45rem",borderRadius:"4px",flexShrink:0,letterSpacing:".3px" }}>{threat}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ───────── 11. AI ROADMAP — COMING SOON ───────── */}
      <section style={{ maxWidth:"1100px",margin:"0 auto",padding:"0 clamp(1.5rem,5vw,2rem) clamp(4rem,8vw,6rem)" }}>
        <div style={{ textAlign:"center",marginBottom:"3.5rem" }}>
          <div style={{ display:"inline-flex",alignItems:"center",gap:".5rem",padding:".35rem 1rem",borderRadius:"100px",background:"rgba(251,191,36,0.1)",border:"1px solid rgba(251,191,36,0.3)",color:"#fbbf24",fontSize:".75rem",fontWeight:700,letterSpacing:"1px",marginBottom:"1.25rem" }}>
            ◆ COMING SOON — ROADMAP 2026–2027
          </div>
          <h2 className="sec-title" style={{ fontSize:"clamp(2rem,4vw,3rem)" }}>
            AI that works while you sleep.<br/>
            <span className="rtext">The smartest inbox ever built.</span>
          </h2>
          <p className="sec-sub" style={{ maxWidth:"500px" }}>
            We are building the most intelligent business email ever shipped.
          </p>
        </div>

        {/* Thread Summariser — Hero Card */}
        <div style={{ background:"rgba(255,255,255,0.02)",border:"1px solid rgba(251,191,36,0.25)",borderRadius:"20px",padding:"2rem",marginBottom:"1.5rem",boxShadow:"0 8px 40px rgba(251,191,36,0.06)" }}>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:"2.5rem",alignItems:"start" }}>
            {/* Left */}
            <div>
              <div style={{ display:"inline-block",fontSize:".68rem",fontWeight:700,letterSpacing:"1px",textTransform:"uppercase",color:"#fbbf24",background:"rgba(251,191,36,0.1)",border:"1px solid rgba(251,191,36,0.2)",padding:".3rem .75rem",borderRadius:"6px",marginBottom:"1rem" }}>Q3 2026</div>
              <h3 style={{ fontSize:"clamp(1.4rem,2.5vw,1.9rem)",fontWeight:900,letterSpacing:"-1px",color:"#f5f0f0",lineHeight:1.15,marginBottom:".75rem" }}>Thread Summariser</h3>
              <p style={{ fontSize:".88rem",color:"#6b6060",lineHeight:1.7,marginBottom:"1.25rem" }}>
                47 emails in a thread. 3 bullet points to understand everything. Arham AI reads the entire conversation and surfaces what actually matters — decisions, blockers, next steps.
              </p>
              <p style={{ fontSize:".88rem",color:"#9ca3af",lineHeight:1.6,fontStyle:"italic",borderLeft:"2px solid rgba(251,191,36,0.3)",paddingLeft:"1rem" }}>
                &ldquo;Never show up to a meeting cold again.&rdquo;
              </p>
            </div>
            {/* Right — Thread UI Preview */}
            <div style={{ background:"rgba(6,0,10,0.8)",borderRadius:"14px",border:"1px solid rgba(255,255,255,0.06)",padding:"1.25rem" }}>
              <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1rem",paddingBottom:".75rem",borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
                <div>
                  <p style={{ fontSize:".8rem",fontWeight:700,color:"#f5f0f0",margin:0 }}>Re: Q3 Budget Discussion</p>
                  <p style={{ fontSize:".68rem",color:"#4b4040",margin:0 }}>47 messages · finance@arhamfintech.ai</p>
                </div>
                <span style={{ fontSize:".65rem",fontWeight:700,color:"#fbbf24",background:"rgba(251,191,36,0.1)",border:"1px solid rgba(251,191,36,0.2)",padding:".2rem .5rem",borderRadius:"5px" }}>47 emails</span>
              </div>
              <div style={{ background:"rgba(251,191,36,0.06)",border:"1px solid rgba(251,191,36,0.2)",borderRadius:"10px",padding:".85rem" }}>
                <p style={{ fontSize:".7rem",fontWeight:700,color:"#fbbf24",letterSpacing:".5px",marginBottom:".6rem" }}>⚡ AI Summary</p>
                {[
                  "Budget approved at ₹18L — 12% above Q2, pending CFO sign-off by Friday.",
                  "Hiring freeze on non-revenue roles until October. Marketing and tech exempt.",
                  "Next action: Chirag to send revised forecast to board by EOD Thursday.",
                ].map((point, i)=>(
                  <div key={i} style={{ display:"flex",gap:".6rem",marginBottom:i<2?".5rem":0 }}>
                    <span style={{ fontSize:".72rem",fontWeight:700,color:"#fbbf24",flexShrink:0,marginTop:".05rem" }}>{i+1}.</span>
                    <p style={{ fontSize:".75rem",color:"#d1c080",lineHeight:1.5,margin:0 }}>{point}</p>
                  </div>
                ))}
              </div>
              <div style={{ display:"flex",gap:".5rem",marginTop:".75rem" }}>
                {["Reply to thread","See full thread"].map((btn)=>(
                  <button key={btn} style={{ flex:1,padding:".45rem",borderRadius:"7px",background:"rgba(255,255,255,0.04)",color:"#6b6060",fontSize:".72rem",fontWeight:600,border:"1px solid rgba(255,255,255,0.07)",cursor:"pointer" }}>{btn}</button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 6-Card Roadmap Grid */}
        <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:"1rem",marginBottom:"1.5rem" }}>
          {[
            { quarter:"Q3 2026", color:"#fbbf24", bg:"rgba(251,191,36,0.08)", border:"rgba(251,191,36,0.2)", icon:"💬", title:"Smart Reply", desc:"Three AI-suggested replies appear before you type a single character. One tap to respond." },
            { quarter:"Q3 2026", color:"#fbbf24", bg:"rgba(251,191,36,0.08)", border:"rgba(251,191,36,0.2)", icon:"📡", title:"Follow-up Radar", desc:"AI surfaces emails you sent that never got a reply — before you forget, before deals slip." },
            { quarter:"Q4 2026", color:"#ef4444", bg:"rgba(220,38,38,0.08)", border:"rgba(220,38,38,0.2)", icon:"🔍", title:"Natural Language Search", desc:"Find emails by describing them in plain English. \"Budget email from Rahul last month\" just works." },
            { quarter:"Q4 2026", color:"#ef4444", bg:"rgba(220,38,38,0.08)", border:"rgba(220,38,38,0.2)", icon:"🎨", title:"Tone Coach", desc:"Rewrite any draft in any tone — more assertive, softer, shorter, more formal — in one click." },
            { quarter:"Q1 2027", color:"#a78bfa", bg:"rgba(139,92,246,0.08)", border:"rgba(139,92,246,0.2)", icon:"📄", title:"Document Intel", desc:"AI summarizes PDF and Word attachments inline so you never open a doc just to find the key number." },
            { quarter:"Q1 2027", color:"#a78bfa", bg:"rgba(139,92,246,0.08)", border:"rgba(139,92,246,0.2)", icon:"📅", title:"Meeting Scheduler AI", desc:"AI reads the thread, finds a time that works for everyone, and books the meeting automatically." },
          ].map(({quarter, color, bg, border, icon, title, desc})=>(
            <div key={title} className="feat-card" style={{ borderColor:`rgba(255,255,255,0.07)` }}>
              <div style={{ position:"relative",zIndex:1 }}>
                <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:".85rem" }}>
                  <div style={{ width:"40px",height:"40px",borderRadius:"10px",background:bg,border:`1px solid ${border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1.1rem" }}>{icon}</div>
                  <span style={{ fontSize:".62rem",fontWeight:700,background:bg,color:color,padding:".2rem .55rem",borderRadius:"5px",border:`1px solid ${border}`,letterSpacing:".3px" }}>{quarter}</span>
                </div>
                <h3 style={{ fontSize:".95rem",fontWeight:700,color:"#f5f0f0",marginBottom:".4rem" }}>{title}</h3>
                <p style={{ fontSize:".82rem",color:"#6b6060",lineHeight:1.6 }}>{desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Priority Inbox AI — Full Width */}
        <div style={{ background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:"16px",padding:"2rem",display:"flex",alignItems:"center",gap:"2rem",marginBottom:"1.5rem",flexWrap:"wrap" }}>
          <div style={{ width:"64px",height:"64px",borderRadius:"16px",background:"linear-gradient(135deg,rgba(220,38,38,0.2),rgba(127,29,29,0.15))",border:"1px solid rgba(220,38,38,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1.8rem",flexShrink:0 }}>🧠</div>
          <div style={{ flex:1,minWidth:"200px" }}>
            <h3 style={{ fontSize:"1.05rem",fontWeight:700,color:"#f5f0f0",marginBottom:".4rem" }}>Priority Inbox AI</h3>
            <p style={{ fontSize:".84rem",color:"#6b6060",lineHeight:1.65,margin:0 }}>
              AI learns what matters to you — VIP senders, urgent keywords, time-sensitive threads — and surfaces them first. The rest waits until you&apos;re ready.
            </p>
          </div>
          <div style={{ textAlign:"center",flexShrink:0 }}>
            <div style={{ fontSize:"2.5rem",fontWeight:900,letterSpacing:"-2px",background:"linear-gradient(135deg,#fca5a5,#ef4444)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text",lineHeight:1 }}>94%</div>
            <div style={{ fontSize:".72rem",color:"#4b4040",fontWeight:600,textTransform:"uppercase",letterSpacing:".4px",marginTop:".2rem" }}>less time in inbox</div>
          </div>
        </div>

        {/* Early Access CTA */}
        <div style={{ textAlign:"center",background:"rgba(220,38,38,0.04)",border:"1px solid rgba(220,38,38,0.15)",borderRadius:"16px",padding:"2rem" }}>
          <p style={{ fontSize:".84rem",color:"#9ca3af",marginBottom:"1rem",lineHeight:1.6 }}>
            These features are shipping across 2026–2027. Join the waitlist to get early access and shape the roadmap.
          </p>
          <Link href="/signup" className="cta-btn">Join the waitlist →</Link>
        </div>
      </section>

      {/* ───────── 12. PRICING TEASER ───────── */}
      <section style={{ padding:"0 clamp(1.5rem,5vw,4rem) clamp(4rem,8vw,5rem)",maxWidth:"720px",margin:"0 auto" }}>
        <div style={{ borderRadius:"20px",background:"rgba(255,255,255,0.02)",border:"1px solid rgba(220,38,38,0.12)",padding:"clamp(2rem,4vw,3rem)",textAlign:"center" }}>
          <p style={{ fontSize:".72rem",fontWeight:700,letterSpacing:"1.5px",textTransform:"uppercase",color:"#ef4444",marginBottom:"1rem" }}>Pricing</p>
          <h2 style={{ fontSize:"clamp(1.5rem,3vw,2rem)",fontWeight:900,letterSpacing:"-1px",color:"#f5f0f0",marginBottom:".75rem" }}>50% less than Zoho. Same deliverability.</h2>
          <div style={{ display:"flex",alignItems:"center",justifyContent:"center",gap:"2.5rem",flexWrap:"wrap",margin:"1.5rem 0 2rem" }}>
            {[
              {name:"Free",price:"₹0",sub:"forever · 5 users"},
              {name:"Starter",price:"₹18",sub:"/user/month · 25 users"},
              {name:"Business",price:"₹35",sub:"/user/month · unlimited"},
            ].map(({name,price,sub},i)=>(
              <div key={name} style={{ textAlign:"center" }}>
                <p style={{ fontSize:".72rem",color:"#4b4040",fontWeight:600,marginBottom:".25rem",textTransform:"uppercase",letterSpacing:".5px" }}>{name}</p>
                <p style={{ fontSize:"2rem",fontWeight:900,color:i===0?"#6b6060":i===1?"#fca5a5":"#ef4444",letterSpacing:"-1px" }}>{price}</p>
                <p style={{ fontSize:".72rem",color:"#4b4040" }}>{sub}</p>
              </div>
            ))}
          </div>
          <Link href="/pricing" style={{ display:"inline-flex",alignItems:"center",gap:".5rem",color:"#ef4444",textDecoration:"none",fontSize:".88rem",fontWeight:600,padding:".6rem 1.25rem",border:"1px solid rgba(220,38,38,0.25)",borderRadius:"10px",background:"rgba(220,38,38,0.06)",transition:"all .15s" }}>
            See full pricing →
          </Link>
        </div>
      </section>

      {/* ───────── 13. CTA BAND ───────── */}
      <section style={{ padding:"clamp(5rem,10vw,8rem) clamp(1.5rem,5vw,4rem)",textAlign:"center",background:"rgba(220,38,38,0.05)",borderTop:"1px solid rgba(220,38,38,0.1)",position:"relative",overflow:"hidden" }}>
        <div style={{ position:"absolute",inset:0,background:"radial-gradient(ellipse 60% 80% at 50% 0%,rgba(220,38,38,0.12),transparent)",pointerEvents:"none" }}/>
        <div style={{ position:"relative",zIndex:1 }}>
          <h2 style={{ fontSize:"clamp(2rem,4vw,3.2rem)",fontWeight:900,letterSpacing:"-1.5px",color:"#f5f0f0",marginBottom:".75rem",lineHeight:1.05 }}>
            Ready to own your<br/>
            <span className="rtext">business inbox?</span>
          </h2>
          <p style={{ color:"#6b6060",maxWidth:"380px",margin:"0 auto 2.5rem",lineHeight:1.7 }}>
            Set up in minutes. Free for up to 5 users, forever. No credit card required.
          </p>
          <div style={{ display:"flex",alignItems:"center",justifyContent:"center",gap:"1rem",flexWrap:"wrap" }}>
            <Link href="/signup" className="cta-btn">Create your workspace free →</Link>
            <Link href="/pricing" className="ghost-btn">See pricing</Link>
          </div>
        </div>
      </section>
    </>
  );
}
