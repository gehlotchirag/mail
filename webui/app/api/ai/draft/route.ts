import { NextRequest, NextResponse } from 'next/server';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

function parseOneBlock(block: string): { subject: string; text: string } {
  const subjectMatch = block.match(/^SUBJECT:\s*(.+)/im);
  const bodyMatch    = block.match(/^BODY:\s*\r?\n([\s\S]*)/im);
  let text = bodyMatch ? bodyMatch[1].trim() : block.trim();
  text = text.replace(/^SUBJECT:.*$/im, '').replace(/^BODY:\s*$/im, '').trim();
  return { subject: subjectMatch?.[1].trim() ?? '', text };
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'AI not configured' }, { status: 503 });
  }

  let prompt: string, subject: string, body: string, to: string[];
  let threadBody: string | undefined, threadFrom: string | undefined, mode: string | undefined;
  try {
    ({ prompt, subject, body, to, threadBody, threadFrom, mode } = await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const wantVariants = (mode === 'reply' || mode === 'replyAll') && !!threadBody;

  const contextParts: string[] = [];
  if (to?.length) contextParts.push(`To: ${to.join(', ')}`);
  if (subject) contextParts.push(`Subject: ${subject}`);
  if (body?.trim()) contextParts.push(`Existing email body:\n${body}`);

  const threadSection = threadBody
    ? `\n\nOriginal email:\nFrom: ${threadFrom || 'Unknown'}\n${threadBody}`
    : '';
  const userMessage = contextParts.length
    ? `Context:\n${contextParts.join('\n')}${threadSection}\n\nInstruction: ${prompt}`
    : `${prompt}${threadSection}`;

  const systemContent = wantVariants
    ? [
        'You are an expert professional email writer.',
        'The user is replying to an email. Generate exactly 3 distinct reply variants.',
        'Use this exact format and nothing else:',
        '',
        'OPTION 1:',
        'SUBJECT: <subject line>',
        'BODY:',
        '<email body as HTML>',
        '',
        'OPTION 2:',
        'SUBJECT: <subject line>',
        'BODY:',
        '<email body as HTML>',
        '',
        'OPTION 3:',
        'SUBJECT: <subject line>',
        'BODY:',
        '<email body as HTML>',
        '',
        'Tone for each option:',
        '- Option 1: Formal and professional',
        '- Option 2: Neutral and direct',
        '- Option 3: Concise and friendly',
        '',
        'Rules for BODY in each option:',
        '- Use proper HTML tags: <p> for paragraphs, <strong> for bold, <em> for italic, <ul>/<li> for bullet lists.',
        '- Every paragraph must be wrapped in <p>...</p>.',
        '- Use <strong> for the greeting line.',
        '- End with a professional sign-off paragraph.',
        '- Do NOT include <html>, <head>, <body>, or <style> tags.',
        '- Do NOT include any text outside the OPTION/SUBJECT/BODY structure.',
      ].join('\n')
    : [
        'You are an expert professional email writer.',
        'Respond in exactly this format and nothing else:',
        'SUBJECT: <subject line here>',
        'BODY:',
        '<email body as HTML here>',
        '',
        'Rules for the BODY:',
        '- Use proper HTML tags: <p> for paragraphs, <strong> for bold, <em> for italic, <ul>/<li> for bullet lists, <ol>/<li> for numbered lists.',
        '- Every paragraph must be wrapped in <p>...</p>.',
        '- Use <strong> for the greeting line (e.g. <p><strong>Dear John,</strong></p>).',
        '- Use <strong> for section headings or key terms where appropriate.',
        '- Use <ul><li>...</li></ul> for any list of items.',
        '- End with a professional sign-off paragraph.',
        '- Do NOT include <html>, <head>, <body>, or <style> tags.',
        '- Do NOT include any text outside the SUBJECT/BODY structure.',
      ].join('\n');

  try {
    const res = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.7,
        max_tokens: wantVariants ? 3000 : 1024,
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      return NextResponse.json({ error: 'Groq API error', detail }, { status: 502 });
    }

    const data = await res.json();
    const raw: string = data.choices?.[0]?.message?.content?.trim() ?? '';

    let variants: Array<{ subject: string; text: string }> = [];
    if (wantVariants) {
      const re = /OPTION\s+\d+:\s*\r?\n([\s\S]*?)(?=OPTION\s+\d+:|$)/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(raw)) !== null) variants.push(parseOneBlock(m[1]));
      // Fallback: if parsing found no variants, treat the whole response as one
      if (variants.length === 0) variants.push(parseOneBlock(raw));
    } else {
      variants.push(parseOneBlock(raw));
    }

    return NextResponse.json({ variants });
  } catch (err) {
    return NextResponse.json({ error: 'Request failed', detail: String(err) }, { status: 502 });
  }
}
