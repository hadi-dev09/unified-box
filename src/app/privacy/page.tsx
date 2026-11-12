import { LegalPage } from "../legal";

export const metadata = { title: "Privacy · Unified Box" };

export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy" updated="November 13, 2026">
      <p>This page explains, in plain language, what Unified Box does with your data.</p>
      <h2>What we access</h2>
      <ul>
        <li><b>Your account:</b> your email address, name and sign-in details.</li>
        <li><b>Connected inboxes:</b> when you connect Gmail or Slack, we read recent messages (sender, recipients, subject, text and date) so we can show them in one place. We only request read access unless you choose “read + send”.</li>
        <li><b>AI connections:</b> if you connect an AI assistant (for example Claude or ChatGPT), it can read your synced messages and create draft replies on your behalf, only while you keep it connected.</li>
      </ul>
      <h2>How we use it</h2>
      <ul>
        <li>To display, search and group your messages, and to send replies you explicitly approve.</li>
        <li>We do not sell your data, use it for advertising, or use it to train AI models.</li>
        <li>Nothing is sent from your accounts without your approval.</li>
      </ul>
      <h2>Google user data</h2>
      <p>Unified Box&apos;s use and transfer of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.</p>
      <h2>Storage and security</h2>
      <ul>
        <li>Data is stored with our infrastructure providers (Supabase for the database, Vercel for hosting).</li>
        <li>Access tokens for your connected accounts are encrypted. AI access tokens and keys are stored only as one-way hashes.</li>
        <li>Each person can only see their own data.</li>
      </ul>
      <h2>Your choices</h2>
      <ul>
        <li><b>Disconnect</b> an inbox anytime: its synced messages are deleted from Unified Box and our access is revoked with the provider.</li>
        <li><b>Revoke</b> any AI assistant or access key anytime.</li>
        <li>To delete your account and all data, contact us.</li>
      </ul>
    </LegalPage>
  );
}
