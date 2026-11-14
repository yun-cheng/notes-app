import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import { isDemoAccount } from '../auth/account';
import { useAccount } from '../auth/AuthContext';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { usePopover } from './usePopover';

const DEMO_WORDS = 'The demo account, for trying the app. Running npm run demo puts its sample notes back as they were.';
const MENU_WIDTH = 232;

/**
 * The open account, the other accounts signed in on this browser to switch to, and adding or signing out of one.
 * Opens from the account at the foot of the sidebar, and from the photo in a phone's title bar.
 */
function AccountMenu({ close, style }: { close: () => void; style: CSSProperties | undefined }) {
  const { account, others, switchTo, addAccount, signOut } = useAccount();
  const run = (action: () => void) => () => {
    close();
    action();
  };
  return (
    <div className="style-menu account-menu" style={style}>
      <div className="account-menu__me">
        <Avatar account={account} size={40} />
        <span className="account-menu__who">
          <strong>
            {account.name}
            {isDemoAccount(account) && <span className="demo-tag">Demo</span>}
          </strong>
          <span>{account.email}</span>
        </span>
      </div>
      {others.length > 0 && <p className="account-menu__label">Switch to</p>}
      {others.map((other) => (
        <button key={other.id} type="button" className="account-menu__item" onClick={run(() => switchTo(other))}>
          <Avatar account={other} />
          <span className="account-menu__who">
            <strong>
              {other.name}
              {isDemoAccount(other) && <span className="demo-tag">Demo</span>}
            </strong>
            <span>{other.email}</span>
          </span>
        </button>
      ))}
      <hr />
      <button type="button" className="account-menu__item" onClick={run(addAccount)}>
        <Icon name="plus" />
        Add another account
      </button>
      <Link to="/settings" className="account-menu__item" onClick={close}>
        <Icon name="settings" />
        Backup & settings
      </Link>
      <button type="button" className="account-menu__item" onClick={run(() => void signOut())}>
        <Icon name="signout" />
        {others.length ? `Sign out of ${account.name}` : 'Sign out'}
      </button>
    </div>
  );
}

/** Who is signed in, at the foot of the sidebar, so it's plain which account the notes belong to. */
export function SidebarAccount() {
  const { account } = useAccount();
  const menu = usePopover<HTMLDivElement>();
  const demo = isDemoAccount(account);
  return (
    <div className="sidebar__account-wrap" ref={menu.root}>
      <button
        type="button"
        className="nav-item sidebar__account"
        aria-expanded={!!menu.open}
        aria-label={`${account.name} (${account.email}): switch account or sign out`}
        title={demo ? DEMO_WORDS : 'Switch account or sign out'}
        onClick={menu.toggle}
      >
        <Avatar account={account} />
        <span className="sidebar__who">
          <span className="sidebar__name">
            {account.name}
            {demo && <span className="demo-tag">Demo</span>}
          </span>
          <span className="sidebar__email">{account.email}</span>
        </span>
      </button>
      {menu.open && <AccountMenu close={menu.close} style={menu.fixedStyle(MENU_WIDTH)} />}
    </div>
  );
}

/** The account's photo in a phone's title bar, opening the same menu. */
export function AccountButton({ className = '' }: { className?: string }) {
  const { account } = useAccount();
  const menu = usePopover<HTMLSpanElement>();
  return (
    <span className={`account-button ${className}`} ref={menu.root}>
      <button
        type="button"
        className="icon-btn"
        aria-expanded={!!menu.open}
        aria-label={`${account.name} (${account.email}): switch account or sign out`}
        title={account.email}
        onClick={menu.toggle}
      >
        <Avatar account={account} />
      </button>
      {menu.open && <AccountMenu close={menu.close} style={menu.fixedStyle(MENU_WIDTH)} />}
    </span>
  );
}

/** "Demo" by every page's title while in the demo account, so it isn't taken for your own. */
export function DemoTag() {
  const { account } = useAccount();
  if (!isDemoAccount(account)) return null;
  return (
    <Link to="/settings" className="demo-tag demo-tag--head" title={DEMO_WORDS}>
      Demo
    </Link>
  );
}
