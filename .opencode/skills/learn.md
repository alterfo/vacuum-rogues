# Learn Skill

Extract lessons from recent bug fixes and code improvements to update CLAUDE.md with best practices.

## Description

Analyzes recent git commits in the current session to identify:
- Common bugs and their fixes
- Architecture patterns that caused issues
- Best practices that emerged from fixes
- Performance improvements
- UI/UX patterns that work

Generates structured rules and guidelines to add to CLAUDE.md.

## Usage

```
/learn [--commits N] [--since DATE]
```

**Options:**
- `--commits N`: Analyze last N commits (default: 10)
- `--since DATE`: Analyze commits since DATE (e.g., "2 hours ago", "today")

**Examples:**
```
/learn
/learn --commits 5
/learn --since "1 day ago"
```

## Instructions

When this skill is invoked:

1. **Analyze Recent Commits**
   - Use `git log` to get recent commits with full diffs
   - Focus on commits from the current session
   - Extract commit messages and code changes

2. **Identify Patterns**
   Look for:
   - **Bug Fixes**: What was broken and how it was fixed
   - **Event Handling**: Propagation issues, eventMode settings
   - **UI/Layout**: Container hierarchy, z-index, click blocking
   - **Performance**: Scaling issues, optimization patterns
   - **Architecture**: Component structure, state management
   - **TypeScript**: Type errors, null checks, strict mode issues

3. **Categorize Lessons**
   Organize findings into categories:
   - **Critical Bugs**: Must-avoid patterns
   - **Best Practices**: Recommended approaches
   - **Performance**: Optimization guidelines
   - **Architecture**: Design patterns
   - **Testing**: E2E test patterns

4. **Generate CLAUDE.md Updates**
   For each lesson, create:
   - **Rule Title**: Short, descriptive name
   - **Problem**: What went wrong
   - **Solution**: How it was fixed
   - **Code Example**: Before/after snippets
   - **Related Files**: Where this pattern appears

5. **Format Output**
   Present updates in CLAUDE.md-compatible format:
   ```markdown
   ## New Rule Section

   ### Rule: [Title]

   **Problem**: [What was broken]

   **Solution**: [How to fix it]

   **Example**:
   ```[language]
   // Before (broken)
   [bad code]

   // After (fixed)
   [good code]
   ```

   **Files**: [list of affected files]
   ```

6. **Ask for Confirmation**
   - Show the generated rules to the user
   - Ask which rules to add to CLAUDE.md
   - Offer to apply updates automatically

## Example Output

After analyzing commits, present:

```markdown
# Lessons Learned from Recent Fixes

Found 3 critical patterns and 5 best practices from 7 commits.

## Critical: Event Propagation in PixiJS UI

**Problem**: UI buttons (quest journal, back to map) were not clickable because parent container had `eventMode='none'`, blocking all child events.

**Root Cause**: Setting `eventMode='none'` on a Container prevents ALL children from receiving events, even if children have `eventMode='static'`.

**Solution**:
- Use default `eventMode='auto'` for containers
- Set `eventMode='none'` only on non-interactive leaf elements
- Always add `event.stopPropagation()` in click handlers to prevent event bubbling

**Example**:
```typescript
// ❌ WRONG - blocks all children
const container = new Container();
container.eventMode = 'none'; // This breaks child buttons!

const button = new Text({ text: 'Click me' });
button.eventMode = 'static'; // Won't work!
container.addChild(button);

// ✅ CORRECT
const container = new Container();
// eventMode defaults to 'auto' - children can receive events

const button = new Text({ text: 'Click me' });
button.eventMode = 'static';
button.on('pointerdown', (event) => {
  event.stopPropagation(); // Prevent bubbling to stage
  handleClick();
});
container.addChild(button);
```

**Files**:
- src/presentation/SpaceFlightScene.ts:526
- src/presentation/PlanetSprite.ts:147
- src/presentation/QuestJournalUI.ts:231

**Proposed CLAUDE.md Section**: "PixiJS Event Handling"

---

## Best Practice: Scale-Dependent UI Elements

**Problem**: After increasing planetary orbital radii 5x, minimap displayed orbits outside its bounds (2750 * 0.25 = 687px > 180px minimap).

**Solution**: When changing world scale, update all scale-dependent UI elements proportionally.

**Example**:
```typescript
// When changing orbital radii from 150-550 to 750-2750 (5x scale)
// Update minimap scale: 0.25 → 0.05 (divide by 5)

private readonly ORBITAL_RADII = [750, 1250, 1750, 2250, 2750]; // 5x
private readonly mapScale: number = 0.05; // Adjusted from 0.25
```

**Checklist for Scale Changes**:
- [ ] Update world coordinates
- [ ] Update minimap scale
- [ ] Update camera zoom bounds
- [ ] Update UI positioning if absolute
- [ ] Test edge cases (min/max zoom)

**Files**:
- src/systems/PlanetGenerator.ts:14
- src/presentation/SystemMiniMap.ts:12

**Proposed CLAUDE.md Section**: "Scaling and Coordinate Systems"

---

Would you like me to:
1. Add these rules to CLAUDE.md?
2. Show more patterns (3 more found)?
3. Create a separate best-practices document?
```

## Implementation Notes

- Use `git log --since="[time]" --pretty=format:"%H|%s|%an|%ad" --date=short` for commit list
- Use `git show [commit-hash]` for full diff
- Parse TypeScript/JavaScript changes for pattern detection
- Focus on commits with "fix", "bug", "issue" in messages
- Correlate multiple commits that touch the same files
- Ignore dependency updates, formatting changes
- Prioritize user-reported bugs over proactive improvements

## Success Criteria

- Extracts at least 3 actionable rules per 10 commits
- Rules are specific with code examples
- Updates are formatted for CLAUDE.md
- User can approve/reject each rule
- No false positives (generic advice)
