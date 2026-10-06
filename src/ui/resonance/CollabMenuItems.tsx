import { useCollabStore } from '../../collab/store';
import { useUiStore } from '../../store/uiStore';
import { IconCollab } from '../icons';

const toast = (message: string, kind: 'info' | 'error' = 'info') => useUiStore.getState().pushToast(message, kind);

/** The collaboration actions from the classic toolbar, as items in the Resonance gear menu. */
export default function CollabMenuItems({ onDone }: { onDone: () => void }) {
  const session = useCollabStore(s => s.session);
  const invite = useCollabStore(s => s.invite);
  const peers = useCollabStore(s => Object.keys(s.peers).length);
  const followMode = useCollabStore(s => s.followMode);
  const shareNotes = useCollabStore(s => s.shareNotes);
  const collab = () => useCollabStore.getState();

  const host = async () => {
    onDone();
    try {
      if (await collab().startSession()) toast('Collaboration session ready. Copy the invite and share it with a peer.');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Collaboration is unavailable in this build.', 'error');
    }
  };
  const join = async () => {
    onDone();
    const raw = window.prompt('Paste a collaboration invite link or fragment');
    if (!raw) return;
    try {
      if (await collab().joinInvite(raw)) toast('Joined a collaboration session.');
      else toast('This collaboration invite is invalid.', 'error');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Collaboration is unavailable in this build.', 'error');
    }
  };
  const copy = async () => {
    onDone();
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite);
      toast('Collaboration invite copied to the clipboard.');
    } catch {
      toast('Clipboard access is unavailable in this browser.', 'error');
    }
  };

  return (
    <>
      <p className="rs-menu__label">
        Collaborate{session ? ` · ${peers <= 0 ? 'just you' : peers === 1 ? 'you + 1' : `you + ${peers}`}` : ''}
      </p>
      {!session ? (
        <>
          <button type="button" role="menuitem" onClick={host}><IconCollab />Start session</button>
          <button type="button" role="menuitem" onClick={join}><IconCollab />Join invite</button>
        </>
      ) : (
        <>
          <button type="button" role="menuitem" onClick={copy}><IconCollab />Copy invite</button>
          <button type="button" role="menuitemcheckbox" aria-checked={followMode} onClick={() => { collab().setFollowMode(!followMode); onDone(); }}>
            <IconCollab />{followMode ? 'Stop following' : 'Follow presenter'}
          </button>
          <button type="button" role="menuitem" onClick={() => { collab().leaveSession(); onDone(); toast('Collaboration session closed.'); }}>
            <IconCollab />Leave session
          </button>
        </>
      )}
      <button type="button" role="menuitemcheckbox" aria-checked={shareNotes} onClick={() => collab().setShareNotes(!shareNotes)}>
        <IconCollab />{shareNotes ? 'Sharing notes & tags' : 'Notes & tags stay local'}
      </button>
    </>
  );
}
