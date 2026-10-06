import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/** Open the app at a hash route and wait for its heading (each test starts from empty storage). */
export async function openApp(page: Page, hash = '') {
  await page.goto(`/${hash}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeAttached();
}

const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** On touch screens a picker is a button ("Species: …") that opens a search sheet; on desktop it's a combobox. */
function pickerTrigger(page: Page, name: string) {
  return page.getByRole('button', { name: new RegExp(`^${escapeRe(name)}: `) });
}

/** Type into a picker and take the first suggestion (desktop combobox or phone search sheet). */
export async function pickOption(page: Page, name: string, text: string) {
  const trigger = pickerTrigger(page, name);
  if (await trigger.isVisible()) {
    await trigger.click();
    await page.getByRole('dialog').getByRole('combobox', { name: `Search ${name}` }).fill(text);
  } else {
    await page.getByRole('combobox', { name, exact: true }).fill(text);
  }
  await page.getByRole('listbox', { name, exact: true }).getByRole('option').first().click();
}

/** The picker shows this value (its input's value on desktop, its button's text on a phone). */
export async function expectPicked(page: Page, name: string, value: string) {
  const trigger = pickerTrigger(page, name);
  if (await trigger.isVisible()) await expect(trigger).toContainText(value);
  else await expect(page.getByRole('combobox', { name, exact: true })).toHaveValue(value);
}

/** Go to a main destination; the nav is the top bar on desktop and the bottom tabs on phones. */
export async function goTo(page: Page, label: 'Build' | 'Calc' | 'Analyse' | 'Pokédex' | 'Pokénav' | 'Match log' | 'Meta' | 'Compare teams') {
  const nav = page.getByRole('navigation', { name: 'Main' }).locator('visible=true');
  if (label === 'Compare teams') {
    // Compare is a tab of Analyse.
    await nav.getByRole('button', { name: 'Analyse', exact: true }).click();
    await page.getByRole('tab', { name: 'Compare' }).click();
  } else if (label === 'Pokénav' && (await nav.getByRole('button', { name: 'Pokénav', exact: true }).count()) === 0) {
    // Champions has no use for it: its default bar and More leave Pokénav out, and its hash opens it.
    await page.evaluate(() => { location.hash = '#atlas'; });
  } else if (label === 'Match log' || label === 'Meta' || (label === 'Pokénav' && (await nav.getByRole('button', { name: 'Pokénav', exact: true }).count()) === 0)) {
    await nav.getByRole('button').last().click();
    await page.getByRole('menuitem', { name: label }).click();
  } else {
    await nav.getByRole('button', { name: label, exact: true }).click();
  }
}

export async function expectNoA11yViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length}) ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
}

/** Switch theme through Settings (More → Settings & credits → Appearance), then close the dialog. */
export async function setTheme(page: Page, theme: 'light' | 'dark') {
  const nav = page.getByRole('navigation', { name: 'Main' }).locator('visible=true');
  await nav.getByRole('button').last().click();
  await page.getByRole('menuitem', { name: /Settings/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: theme === 'light' ? 'Light' : 'Dark' }).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark)/);
}

/** Import a Showdown/PTB text as a new team through Team actions → Import / Export → Import. */
export async function importTeam(page: Page, text: string) {
  await page.getByRole('button', { name: 'Team actions' }).click();
  await page.getByRole('menuitem', { name: 'Import / Export' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: /import/i }).click();
  await dialog.getByRole('textbox', { name: 'Text to import' }).fill(text);
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(dialog).toBeHidden();
}

/** A small doubles team: a Mega Stone holder, a Fire type and a few more. Legal in Champions Reg M-C. */
export const SAMPLE_TEAM = `Garchomp @ Garchompite
Ability: Rough Skin
EVs: 2 HP / 32 Atk / 32 Spe
Jolly Nature
- Earthquake
- Dragon Claw

Incineroar @ Sitrus Berry
Ability: Intimidate
EVs: 32 HP / 32 Atk
Adamant Nature
- Flare Blitz
- Fake Out
`;

/** Three Fire types: weak to Water, Rock and Ground, and nothing covers it. */
export const FIRE_TEAM = `Incineroar @ Sitrus Berry
Ability: Intimidate
Adamant Nature
- Flare Blitz
- Fake Out

Arcanine @ Sitrus Berry
Ability: Intimidate
Adamant Nature
- Flare Blitz
- Extreme Speed

Charizard @ Charizardite Y
Ability: Blaze
Timid Nature
- Heat Wave
- Air Slash
`;

/** The stat calculator (Stat Points, EVs…) is always open on desktop and a collapsed section on phones. */
export async function openStatCalculator(page: Page) {
  const probe = page.getByRole('button', { name: 'Optimise', exact: true });
  if (await probe.isVisible()) return;
  await page.getByRole('heading', { name: /Stat Point Calculator|EVs & IVs/ }).click();
  await expect(probe).toBeVisible();
}

/** A full six for the planner tests. */
export const SIX_TEAM = `Incineroar @ Sitrus Berry
Ability: Intimidate
EVs: 32 HP / 32 Atk
Adamant Nature
- Fake Out
- Flare Blitz
- Knock Off
- Parting Shot

Garchomp @ Garchompite
Ability: Rough Skin
EVs: 2 HP / 32 Atk / 32 Spe
Jolly Nature
- Earthquake
- Dragon Claw
- Rock Slide
- Protect

Whimsicott @ Focus Sash
Ability: Prankster
EVs: 2 HP / 32 Spe
Timid Nature
- Tailwind
- Moonblast
- Encore
- Protect

Dragapult @ Choice Specs
Ability: Clear Body
EVs: 32 SpA / 32 Spe
Timid Nature
- Shadow Ball
- Draco Meteor
- Flamethrower
- U-turn

Kingambit @ Black Glasses
Ability: Defiant
EVs: 32 HP / 32 Atk
Adamant Nature
- Sucker Punch
- Kowtow Cleave
- Iron Head
- Protect

Rillaboom @ Assault Vest
Ability: Grassy Surge
EVs: 32 HP / 32 Atk
Adamant Nature
- Grassy Glide
- Wood Hammer
- Fake Out
- U-turn
`;

/** Name the build by saving it under that name (the header's Save button); the build itself stays open. */
export async function renameTeam(page: Page, name: string) {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save team' });
  await dialog.getByRole('textbox', { name: 'Team name' }).fill(name);
  await dialog.getByRole('button', { name: /^(Save|Update)$/ }).click();
  await expect(dialog).toBeHidden();
}
