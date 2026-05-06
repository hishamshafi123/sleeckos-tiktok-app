
export default function PrivacyPage() {
  return (
    <>
      <main className="flex-1 container mx-auto px-4 py-12 max-w-3xl prose prose-slate dark:prose-invert">
        <h1>Privacy Policy</h1>
        <p>Last updated: {new Date().toLocaleDateString()}</p>

        <h2>1. Introduction</h2>
        <p>
          Welcome to Sleeckos. We respect your privacy and are committed to protecting your personal data.
          This policy explains what data we collect, why we collect it, and how it is used when you connect
          your TikTok account to our platform.
        </p>

        <h2>2. Data We Collect from TikTok</h2>
        <p>
          When you authenticate with TikTok through Sleeckos, we request the following permissions
          (scopes) from the TikTok API. Each scope and the specific data fields we use are listed below.
        </p>

        <h3>2a. <code>user.info.basic</code> — Basic Profile (Login Kit)</h3>
        <p>Required to identify you and display your account on our platform. We collect:</p>
        <ul>
          <li><strong>open_id</strong> — a unique identifier for your TikTok account on Sleeckos</li>
          <li><strong>display_name</strong> — shown on your creator profile card</li>
          <li><strong>avatar_url</strong> — your profile picture displayed in the dashboard</li>
          <li><strong>username</strong> — displayed on your public creator profile</li>
        </ul>

        <h3>2b. <code>user.info.profile</code> — Extended Profile</h3>
        <p>
          Required so that brands reviewing creator applications can verify creator identity and
          authenticity before approving them for campaigns. We collect:
        </p>
        <ul>
          <li><strong>bio_description</strong> — shown to brands during creator vetting</li>
          <li><strong>is_verified</strong> — used as a trust signal in the marketplace</li>
          <li><strong>profile_web_link</strong> — linked from your public creator profile</li>
          <li><strong>profile_deep_link</strong> — used to deep-link brands to your TikTok page</li>
        </ul>

        <h3>2c. <code>user.info.stats</code> — Audience Statistics</h3>
        <p>
          Required for brand campaigns that have minimum follower count requirements. We collect:
        </p>
        <ul>
          <li><strong>follower_count</strong> — checked against campaign eligibility thresholds</li>
          <li><strong>following_count</strong> — displayed on your creator profile</li>
          <li><strong>likes_count</strong> — shown as a credibility indicator to brands</li>
          <li><strong>video_count</strong> — indicates creator activity level</li>
        </ul>
        <p>Statistics are refreshed each time you reconnect your TikTok account.</p>

        <h3>2d. <code>video.publish</code> — Direct Publishing (Content Posting API)</h3>
        <p>
          Required to post your approved campaign deliverable videos directly to your TikTok account
          once a brand approves your draft. All posts are published with TikTok&#39;s{" "}
          <strong>Branded Content (Paid Partnership)</strong> disclosure toggle permanently enabled.
          We do not publish any content without your explicit action in the Sleeckos composer.
        </p>

        <h3>2e. <code>video.upload</code> — Draft Upload (Content Posting API)</h3>
        <p>
          Required to submit campaign videos as drafts to your TikTok inbox, where you can review
          and make final edits before publishing. Drafts are only created when you initiate the upload
          inside the Sleeckos publishing flow.
        </p>

        <h2>3. How We Use Your Data</h2>
        <ul>
          <li>To create and maintain your Sleeckos creator account</li>
          <li>To display your profile to brands reviewing campaign applications</li>
          <li>To enforce campaign eligibility rules (e.g. minimum follower counts)</li>
          <li>To publish or draft campaign videos on your behalf when you choose to do so</li>
          <li>We do NOT sell your data to any third parties</li>
          <li>We do NOT use your data for advertising profiling</li>
        </ul>

        <h2>4. Data Retention</h2>
        <p>
          We retain your TikTok profile data and access tokens only while your account is connected.
          Tokens are stored securely server-side (never exposed to the browser). You can revoke
          access at any time from the <strong>Settings</strong> page, which immediately invalidates
          your token on TikTok and deletes it from our database.
        </p>

        <h2>5. Your Rights</h2>
        <p>
          Under GDPR and CCPA, you have the right to access, correct, or delete the information we
          hold about you. To exercise these rights, contact us at the address below.
        </p>

        <h2>6. Contact Us</h2>
        <p>
          If you have any questions about this Privacy Policy, please contact us at{" "}
          <a href="mailto:support@sleeckos.com">support@sleeckos.com</a>.
        </p>
      </main>
    </>
  );
}
