import { displayTitle, firstLine } from '../../domain/content';
import { isTemplate } from '../../domain/templates';
import type { NoteCard, TodoCard } from '../../domain/types';
import { useCards } from '../../state/CardsContext';
import { CardLink, Empty, Page } from '../components';
import { colorClass } from '../EntryStyle';
import { Icon } from '../Icon';
import { useNewTemplate, useStartFromTemplate } from '../useTemplates';
import { useViewOnly } from '../viewOnly';

/** Templates by name. */
export function useTemplateList(): (NoteCard | TodoCard)[] {
  const { index } = useCards();
  return index.live.filter(isTemplate).sort((a, b) => displayTitle(a).localeCompare(displayTitle(b)));
}

/**
 * The templates: each with Use, which starts a new entry from it, and its name, which opens it to change. New
 * template makes an empty one; any entry's menu saves a copy of it as one.
 */
export function TemplatesPage() {
  const templates = useTemplateList();
  const use = useStartFromTemplate();
  const make = useNewTemplate();
  const viewOnly = useViewOnly();
  return (
    <Page
      title="Templates"
      actions={
        !viewOnly && (
          <button type="button" className="btn" onClick={() => void make()}>
            <Icon name="plus" size={16} />
            New template
          </button>
        )
      }
    >
      <p className="prose-note templates__intro">
        Start a note or todo from one of these: its text, checklists (unticked), tags and color come along, and <code>{'{date}'}</code> in it becomes the day it's
        used. Save any entry as a template from its menu.
      </p>
      {templates.length === 0 ? (
        <Empty>No templates yet. Make one here, or pick Save as template in an entry's menu.</Empty>
      ) : (
        <ul className="templates">
          {templates.map((t) => (
            <li key={t.id} className={`templates__item${colorClass(t)}`}>
              <Icon name={t.type === 'todo' ? 'todo' : 'note'} size={18} />
              <CardLink className="templates__name" card={t}>
                <strong>{displayTitle(t)}</strong>
                {t.title.trim() && firstLine(t.content) && <span>{firstLine(t.content)}</span>}
              </CardLink>
              {!viewOnly && (
                <button type="button" className="btn btn--primary" onClick={() => void use(t)}>
                  Use
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
