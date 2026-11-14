import { NavLink, Link } from 'react-router';
import { accountInitial, isDemoAccount } from '../auth/account';
import { useAccount } from '../auth/AuthContext';

const DEMO_WORDS = 'The demo account. Running npm run demo wipes it and starts it over.';

/** A round badge with the account's first letter. */
function Avatar() {
  const { account } = useAccount();
  return (
    <span className={`avatar${isDemoAccount(account) ? ' is-demo' : ''}`} aria-hidden="true">
      {accountInitial(account)}
    </span>
  );
}

/** Who is signed in, at the foot of the sidebar, so it's plain which account the notes belong to. */
export function SidebarAccount() {
  const { account } = useAccount();
  const demo = isDemoAccount(account);
  return (
    <NavLink to="/settings" className="nav-item sidebar__account" title={demo ? DEMO_WORDS : 'Account, backup and settings'}>
      <Avatar />
      <span className="sidebar__who">
        <span className="sidebar__name">
          {account.name}
          {demo && <span className="demo-tag">Demo</span>}
        </span>
        <span className="sidebar__email">{account.email}</span>
      </span>
    </NavLink>
  );
}

/** The account's badge in a phone's title bar, opening settings. */
export function AccountButton({ className = '' }: { className?: string }) {
  const { account } = useAccount();
  return (
    <NavLink className={`icon-btn ${className}`} to="/settings" aria-label={`${account.name} (${account.email}): account, backup and settings`} title={account.email}>
      <Avatar />
    </NavLink>
  );
}

/** "Demo" by every page's title while in the demo account, since anything added there can be wiped. */
export function DemoTag() {
  const { account } = useAccount();
  if (!isDemoAccount(account)) return null;
  return (
    <Link to="/settings" className="demo-tag demo-tag--head" title={DEMO_WORDS}>
      Demo
    </Link>
  );
}
