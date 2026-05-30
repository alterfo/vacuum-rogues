import type { SkillBonus } from '@/types';

export interface SkillBranch {
  readonly name: string;
  readonly levels: SkillLevel[];
  readonly currentLevel: number;
}

export interface SkillLevel {
  readonly level: number;
  readonly bonus: SkillBonus;
}

export class SkillTree {
  availablePoints = 0;

  constructor(public readonly branches: SkillBranch[]) {}

  investPoint(branchName: string, _level: number): boolean {
    const branch = this.branches.find((b) => b.name === branchName);
    if (!branch || this.availablePoints <= 0) return false;
    if (branch.currentLevel < branch.levels.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (branch as any).currentLevel = branch.currentLevel + 1;
      this.availablePoints--;
      return true;
    }
    return false;
  }

  getBonuses(): SkillBonus {
    const bonuses: SkillBonus = {};
    for (const branch of this.branches) {
      for (let i = 0; i < branch.currentLevel; i++) {
        const level = branch.levels[i];
        if (level) {
          for (const [key, value] of Object.entries(level.bonus)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (bonuses as any)[key] = ((bonuses as any)[key] ?? 0) + value;
          }
        }
      }
    }
    return bonuses;
  }
}
