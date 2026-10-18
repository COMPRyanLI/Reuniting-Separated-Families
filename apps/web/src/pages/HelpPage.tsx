export function HelpPage() {
  return (
    <div className="narrow stack">
      <h1>How this works, and its limits</h1>
      <h2>Private by default</h2>
      <p>
        There is no public list of people and no search that shows who is registered. Someone looking for you sends a
        private request. Nothing about you is shared unless you choose to answer, and you choose exactly what to share
        with that one person.
      </p>
      <h2>Check-ins are history, not live location</h2>
      <p>
        A check-in records where you were at a stated time, for example a shelter or an area. It never shows where you
        are now, and it is not proof that anyone is safe. This service never uses GPS or tracks devices.
      </p>
      <h2>No phone or ID?</h2>
      <p>
        Shelter staff can record a check-in and pass on requests for you. They act as themselves, record your decisions,
        and give you a reference card plus a separate private secret for later visits. Keep the secret private.
      </p>
      <h2>Lost your sign-in details?</h2>
      <p>
        Use the recovery secret you saved when you signed up. A relative cannot recover your account for you, and staff
        cannot reset it based on someone claiming to know you.
      </p>
      <h2>Children and people who cannot consent</h2>
      <p>
        This demo does not decide who is a guardian. Shelter staff refer these situations to a specialised process
        instead of sharing information through this site.
      </p>
      <h2>Deleting your information</h2>
      <p>
        Deleting ends access at once and removes your check-ins, messages and profile at the same time. Copies other people
        already made cannot be recalled, and host backups, where they exist, keep older copies until they expire.
      </p>
      <p>
        Other clean-up runs on a schedule, for example removing the text of unanswered requests 30 days after they close. On a
        demo host that sleeps when nobody is using it, the schedule only runs while the site is awake, so clean-up can happen
        later than planned. Expiry and revoked shares never wait for it: they are checked every time something is opened.
      </p>
      <h2>What this demo is not</h2>
      <p>
        It is a challenge prototype with fictional data. It is not monitored, cannot send rescue, and must not be used
        for real people.
      </p>
    </div>
  );
}
