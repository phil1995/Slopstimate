<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import Brand from './Brand.svelte';
  import Icon from './Icon.svelte';
  import Modal from './Modal.svelte';
  import { RoomController } from './room.svelte';
  import { FIBONACCI, TSHIRT } from '../shared/protocol';
  import {
    deck as validateDeck,
    text as validateText,
  } from '../shared/validation';
  let { id }: { id: string } = $props();
  const c = new RoomController(untrack(() => id));
  let name = $state('');
  let copied = $state(false);
  let shareOpen = $state(false);
  let settingsOpen = $state(false);
  let renameOpen = $state(false);
  let showSaved = $state(false);
  let title = $state('');
  let choices = $state('');
  let settingsError = $state('');
  let confirmation = $state<'delete' | 'leave' | null>(null);
  let copyTimer: ReturnType<typeof setTimeout>;
  const online = $derived(c.room?.members.filter((m) => m.connected) ?? []);
  const voted = $derived(online.filter((m) => m.voted).length);
  const savedCount = $derived((c.room?.members.length ?? 0) - online.length);
  const members = $derived(showSaved ? (c.room?.members ?? []) : online);
  const me = $derived(c.room?.members.find((m) => m.id === c.memberId));
  const ready = $derived(c.connection === 'connected' && !c.busy);
  const allVotes = $derived(
    c.room?.revealed
      ? c.room.members.filter((m) => m.vote !== null && m.vote !== undefined)
      : [],
  );
  const numericVotes = $derived(
    allVotes
      .map((m) => m.vote!)
      .filter((v) => /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(v))
      .map(Number)
      .filter(Number.isFinite),
  );
  const average = $derived(
    numericVotes.length
      ? (
          numericVotes.reduce((a, b) => a + b, 0) / numericVotes.length
        ).toLocaleString(undefined, { maximumFractionDigits: 1 })
      : null,
  );
  const tally = $derived(
    c.room?.deck
      .map((vote) => ({
        vote,
        count: allVotes.filter((m) => m.vote === vote).length,
      }))
      .filter((item) => item.count > 0) ?? [],
  );
  onMount(() => {
    void c.start();
    return () => {
      c.destroy();
      clearTimeout(copyTimer);
    };
  });
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${location.origin}/r/${id}`);
      copied = true;
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copied = false), 2500);
    } catch {
      shareOpen = true;
    }
  }
  function openSettings() {
    title = c.room!.title;
    choices = c.room!.deck.join('\n');
    settingsError = '';
    c.error = '';
    settingsOpen = true;
  }
  async function saveSettings(event: SubmitEvent) {
    event.preventDefault();
    settingsError = '';
    try {
      const nextTitle = validateText(title, 'Title', 80, 'Planning Poker');
      const nextDeck = validateDeck(choices.split(/\r?\n/));
      if (await c.admin('settings', { title: nextTitle, deck: nextDeck }))
        settingsOpen = false;
    } catch (error) {
      settingsError =
        error instanceof Error ? error.message : 'Check your settings.';
    }
  }
  async function join(event: SubmitEvent) {
    event.preventDefault();
    if (await c.join(name)) name = '';
  }
  async function rename(event: SubmitEvent) {
    event.preventDefault();
    if (await c.join(name)) renameOpen = false;
  }
  async function confirm() {
    const success =
      confirmation === 'delete' ? await c.delete() : await c.leave();
    if (success) confirmation = null;
  }
</script>

<svelte:head
  ><title>{c.room?.title ?? 'Your room'} — Slopstimate</title></svelte:head
>
<div class="site-shell room-shell">
  <header class="site-header">
    <Brand />
    <div class="header-meta">
      <span class="small-pill">PLANNING POKER</span><a
        class="quiet-link"
        href="https://github.com/phil1995/Slopstimate"
        target="_blank"
        rel="noreferrer">GitHub <Icon name="arrow" size={15} /></a
      >
    </div>
  </header>
  {#if c.loading}
    <main id="main-content" class="empty-page" aria-live="polite">
      <div class="spinner"></div>
      <h1>Making room for you…</h1>
      <p>Getting the team’s latest round.</p>
    </main>
  {:else if c.notFound}
    <main id="main-content" class="empty-page">
      <div class="empty-icon"><Icon name="link" size={30} /></div>
      <span class="eyebrow">ROOM NOT FOUND</span>
      <h1>This room isn’t here.</h1>
      <p>
        The link may be incorrect, or the admin may have deleted the room.<br
        />A fresh start is only a click away.
      </p>
      <a class="button primary" href="/"
        >Create a new room <Icon name="arrow" /></a
      >
    </main>
  {:else if !c.room}
    <main id="main-content" class="empty-page">
      <h1>We couldn’t reach the room.</h1>
      <p role="alert">{c.error}</p>
      <button class="button primary" onclick={() => c.start()}
        >Try again <Icon name="reset" /></button
      >
    </main>
  {:else}
    <main id="main-content" class="room-main">
      <div class="room-heading">
        <div>
          <div class="eyebrow">YOUR TEAM’S ESTIMATION ROOM</div>
          <h1>{c.room.title}</h1>
          <div class="room-subtitle">
            <span class="connection" class:live={c.connection === 'connected'}
              ><span class="tiny-dot"></span>{{
                connected: 'Live connection',
                connecting: 'Connecting…',
                reconnecting: 'Reconnecting…',
                offline: 'You’re offline',
                join: 'Join to connect',
              }[c.connection]}</span
            ><span class="subtitle-dot">·</span><span>Round {c.room.round}</span
            >{#if c.isAdmin}<span class="admin-badge">You’re the admin</span
              >{/if}
          </div>
        </div>
        <div class="heading-actions">
          <button class="button secondary" onclick={copyLink}
            ><Icon name={copied ? 'check' : 'link'} size={18} />{copied
              ? 'Link copied'
              : 'Invite team'}</button
          >{#if c.isAdmin}<button
              class="icon-button settings-button"
              aria-label="Room settings"
              onclick={openSettings}
              disabled={!ready}><Icon name="sliders" /></button
            >{/if}
        </div>
      </div>
      {#if c.error}<div class="alert room-alert" role="alert">
          <span>{c.error}</span><button
            class="icon-button"
            aria-label="Dismiss error"
            onclick={() => (c.error = '')}
            ><Icon name="close" size={16} /></button
          >
        </div>{/if}
      {#if c.connection === 'offline' || c.connection === 'reconnecting'}<div
          class="connection-notice"
          role="status"
        >
          {c.connection === 'offline'
            ? 'You’re offline. Your last saved round is shown below.'
            : 'Reconnecting to the room. We’ll catch up with the current round automatically.'}<button
            class="text-button"
            onclick={c.connect}>Retry now</button
          >
        </div>{/if}
      <div class="room-grid">
        <section class="voting-panel panel" aria-labelledby="vote-title">
          <div class="panel-top">
            <span class="section-label"
              ><Icon name="spark" size={17} /> THE ROUND</span
            ><span class="round-pill" class:revealed={c.room.revealed}
              ><span class="tiny-dot"></span>{c.room.revealed
                ? 'Revealed'
                : 'Voting in progress'}</span
            >
          </div>
          {#if !c.hasMembership && !(c.isAdmin && c.room.revealed)}
            <div class="join-content">
              <div class="empty-icon"><Icon name="people" size={28} /></div>
              <h2 id="vote-title">Pull up a chair.</h2>
              <p>
                Join with a name so the team knows who’s here.<br />Your
                estimates stay hidden until the reveal.
              </p>
              <form class="join-form" onsubmit={join}>
                <label for="join-name">Your display name</label><input
                  id="join-name"
                  bind:value={name}
                  placeholder="e.g. Alex"
                  maxlength="80"
                  autocomplete="nickname"
                  required
                /><button
                  class="button primary"
                  type="submit"
                  disabled={c.busy || !name.trim()}
                  >{c.busy ? 'Joining…' : 'Join the room'}<Icon
                    name="arrow"
                  /></button
                >
              </form>
              {#if c.isAdmin}<p class="microcopy">
                  You can also stay here as a facilitator.
                </p>{/if}
            </div>
          {:else if c.room.revealed}
            <div class="round-content reveal-content">
              <h2 id="vote-title">The cards are on the table.</h2>
              <p>
                {allVotes.length
                  ? 'Different estimates? That’s where the conversation starts.'
                  : 'No estimates this round. Start a new one when everyone is ready.'}
              </p>
              <div class="tally" aria-label="Vote tally">
                {#each tally as item (item.vote)}<div class="tally-item">
                    <strong>{item.vote}</strong><span
                      >{item.count} {item.count === 1 ? 'vote' : 'votes'}</span
                    >
                  </div>{/each}
              </div>
              {#if average !== null}<div class="average">
                  <span>Numeric average</span><strong>{average}</strong><small
                    >From {numericVotes.length} numeric {numericVotes.length ===
                    1
                      ? 'estimate'
                      : 'estimates'}. Includes saved members’ current votes.</small
                  >
                </div>{/if}
              <div class="vote-note">
                <Icon name="eye" size={17} /><span
                  >Voting is locked until the next round.</span
                >
              </div>
            </div>
          {:else}
            <div class="round-content">
              <h2 id="vote-title">What’s your estimate?</h2>
              <p>Go with your first instinct. You can change your mind.</p>
              <div
                class="vote-deck"
                role="group"
                aria-label="Choose your estimate"
              >
                {#each c.room.deck as vote (vote)}<button
                    class="vote-card"
                    class:selected={c.selected === vote}
                    class:long-option={vote.length > 3}
                    aria-label={vote === '☕'
                      ? 'Vote coffee break'
                      : `Vote ${vote}`}
                    aria-pressed={c.selected === vote}
                    disabled={!ready}
                    onclick={() => c.vote(vote)}
                    ><span class="card-corner" aria-hidden="true">{vote}</span
                    ><strong
                      >{#if vote === '☕'}<Icon
                          name="coffee"
                          size={30}
                        />{:else}{vote}{/if}</strong
                    ><span class="card-bottom" aria-hidden="true"
                      >{c.selected === vote ? '✓' : vote}</span
                    ></button
                  >{/each}
              </div>
              <div class="vote-note" aria-live="polite">
                <Icon name={me?.voted ? 'check' : 'lock'} size={17} /><span
                  >{me?.voted
                    ? 'Your estimate is in. It stays private until the reveal.'
                    : 'Only you know your choice. Everyone reveals together.'}</span
                >
              </div>
            </div>
          {/if}
          <div class="round-footer">
            <div class="round-progress">
              <span
                ><strong>{voted}</strong> of <strong>{online.length}</strong> connected
                participants voted</span
              ><progress
                value={voted}
                max={Math.max(online.length, 1)}
                aria-label={`${voted} of ${online.length} connected participants voted`}
              ></progress>
            </div>
            {#if c.isAdmin}<div class="admin-round-actions">
                {#if c.room.revealed}<button
                    class="button primary"
                    disabled={!ready}
                    onclick={() => c.admin('reset')}
                    ><Icon name="reset" size={18} />Next round</button
                  >{:else}<button
                    class="button primary"
                    disabled={!ready}
                    onclick={() => c.admin('reveal')}
                    ><Icon name="eye" size={18} />Reveal cards</button
                  ><button
                    class="text-button"
                    disabled={!ready}
                    onclick={() => c.admin('reset')}>Reset round</button
                  >{/if}
              </div>{:else}<span class="waiting-note"
                >{c.room.revealed
                  ? 'The admin will start the next round.'
                  : 'The admin reveals when the team is ready.'}</span
              >{/if}
          </div>
        </section>
        <aside class="participants-panel panel" aria-labelledby="team-title">
          <div class="participants-heading">
            <h2 id="team-title">
              <Icon name="people" size={19} />At the table
            </h2>
            <span class="count-badge">{online.length}</span>
          </div>
          <div
            class="roster-tabs"
            role="group"
            aria-label="Participant visibility"
          >
            <button
              class:active={!showSaved}
              aria-pressed={!showSaved}
              onclick={() => (showSaved = false)}
              >Connected <span>{online.length}</span></button
            ><button
              class:active={showSaved}
              aria-pressed={showSaved}
              onclick={() => (showSaved = true)}
              >All members <span>{c.room.members.length}</span></button
            >
          </div>
          <div class="roster">
            {#each members as member, index (member.id)}<div
                class="member-row"
                class:member-offline={!member.connected}
              >
                <div
                  class="avatar"
                  class:avatar-purple={index % 4 === 0}
                  class:avatar-blue={index % 4 === 1}
                  class:avatar-peach={index % 4 === 2}
                  class:avatar-green={index % 4 === 3}
                >
                  {member.name.slice(0, 2).toUpperCase()}
                </div>
                <div class="member-name">
                  <strong
                    >{member.name}{#if member.id === c.memberId}<span
                        class="you-tag">you</span
                      >{/if}</strong
                  ><span
                    >{!member.connected
                      ? 'Offline · saved member'
                      : c.room.revealed
                        ? member.voted
                          ? 'Estimate revealed'
                          : 'No estimate'
                        : member.voted
                          ? 'Ready to reveal'
                          : 'Thinking…'}</span
                  >
                </div>
                {#if c.room.revealed}<span class="revealed-vote"
                    >{member.vote ?? '—'}</span
                  >{:else if member.voted}<span
                    class="member-voted"
                    aria-label="Voted"><Icon name="check" size={15} /></span
                  >{:else}<span class="member-pending" aria-label="Not voted"
                    >—</span
                  >{/if}
              </div>{:else}<div class="empty-roster">
                <Icon name="people" size={30} />
                <p>
                  {showSaved
                    ? 'A good conversation starts with a team.'
                    : 'No one’s connected yet.'}
                </p>
                <button class="text-button" onclick={copyLink}
                  >Invite someone <Icon name="arrow" size={15} /></button
                >
              </div>{/each}
          </div>
          <div class="roster-footer">
            {#if savedCount > 0}<p>
                {savedCount} saved {savedCount === 1
                  ? 'member is'
                  : 'members are'} offline.
              </p>{:else}<p>
                Good estimates start with different perspectives.
              </p>{/if}{#if c.hasMembership}<div class="identity-actions">
                <button
                  class="text-button"
                  onclick={() => {
                    name = c.name;
                    c.error = '';
                    renameOpen = true;
                  }}
                  disabled={!ready}
                  ><Icon name="edit" size={14} />Change name</button
                ><button
                  class="text-button"
                  onclick={() => {
                    c.error = '';
                    confirmation = 'leave';
                  }}
                  disabled={!ready}
                  ><Icon name="exit" size={14} />Leave room</button
                >
              </div>{/if}
          </div>
        </aside>
      </div>
      <div class="room-bottom-note">
        <Icon name="clock" size={17} /><span
          >Same team, next week? Keep this link. The room is yours to reuse.</span
        ><span class="private-note"
          ><Icon name="lock" size={15} />No vote history</span
        >
      </div>
      {#if !c.isAdmin}<p class="admin-explanation">
          Admin access stays in the browser that created the room. Lost access
          can’t be recovered; create a new room if needed.
        </p>{/if}
    </main>
  {/if}
  <footer class="site-footer">
    <span>Less ceremony. More conversation.</span><a href="/" class="quiet-link"
      >Start a new room <Icon name="arrow" size={15} /></a
    >
  </footer>
</div>
<Modal
  open={shareOpen}
  title="Invite your team"
  onClose={() => (shareOpen = false)}
  ><p>Share this link. It gives your team participant access.</p>
  <label for="room-link">Room link</label><input
    id="room-link"
    value={`${location.origin}/r/${id}`}
    readonly
    onclick={(event) => event.currentTarget.select()}
  />
  <p class="microcopy">Select the link and copy it to your clipboard.</p></Modal
>
<Modal
  open={settingsOpen}
  title="Room settings"
  onClose={() => {
    if (!c.busy) settingsOpen = false;
  }}
  ><form onsubmit={saveSettings}>
    <label for="room-title">Room name</label><input
      id="room-title"
      bind:value={title}
      maxlength="160"
      placeholder="Planning Poker"
    /><label for="deck-options">Deck options</label><textarea
      id="deck-options"
      bind:value={choices}
      rows="3"
      required></textarea>
    <p class="input-help">
      One option per line. 2–20 unique choices, up to 16 characters each.
    </p>
    <div class="preset-buttons">
      <button
        class="button secondary compact"
        type="button"
        onclick={() => (choices = FIBONACCI.join('\n'))}>Fibonacci</button
      ><button
        class="button secondary compact"
        type="button"
        onclick={() => (choices = TSHIRT.join('\n'))}>T-shirt sizes</button
      >
    </div>
    <div class="settings-notice">
      <Icon name="reset" size={18} />
      <p>Changing the deck starts a new round and clears current votes.</p>
    </div>
    {#if settingsError || c.error}<p role="alert" class="alert">
        {settingsError || c.error}
      </p>{/if}<button
      class="button primary full-width"
      type="submit"
      disabled={!ready}>{c.busy ? 'Saving…' : 'Save settings'}</button
    >
  </form>
  <div class="danger-zone">
    <p>Deleting a room removes its members and current votes permanently.</p>
    <button
      class="text-button danger-text"
      onclick={() => {
        settingsOpen = false;
        c.error = '';
        confirmation = 'delete';
      }}
      disabled={!ready}>Delete this room</button
    >
  </div></Modal
>
<Modal
  open={renameOpen}
  title="Change your name"
  onClose={() => {
    if (!c.busy) renameOpen = false;
  }}
  ><form onsubmit={rename}>
    <label for="new-name">Your display name</label><input
      id="new-name"
      bind:value={name}
      maxlength="80"
      required
      autocomplete="nickname"
    />{#if c.error}<p class="alert" role="alert">{c.error}</p>{/if}<button
      class="button primary full-width"
      type="submit"
      disabled={!ready || !name.trim()}>Save name</button
    >
  </form></Modal
>
<Modal
  open={confirmation !== null}
  title={confirmation === 'delete' ? 'Delete this room?' : 'Leave the room?'}
  onClose={() => {
    if (!c.busy) confirmation = null;
  }}
  ><p>
    {confirmation === 'delete'
      ? 'This permanently deletes the room, its members, and its current votes. The shared link will stop working. This cannot be undone.'
      : 'Your membership and current vote will be removed, and this device will forget your participant identity. You can join again with a new name.'}
  </p>
  {#if confirmation === 'leave' && c.isAdmin}<p class="input-help">
      You’ll keep admin access in this browser and can still facilitate.
    </p>{/if}{#if c.error}<p class="alert" role="alert">{c.error}</p>{/if}
  <div class="confirmation-actions">
    <button
      class="button secondary"
      disabled={c.busy}
      onclick={() => (confirmation = null)}>Cancel</button
    ><button
      class="button"
      class:danger={confirmation === 'delete'}
      class:primary={confirmation === 'leave'}
      disabled={!ready}
      onclick={confirm}
      >{c.busy
        ? 'Working…'
        : confirmation === 'delete'
          ? 'Delete permanently'
          : 'Leave and forget me'}</button
    >
  </div></Modal
>
