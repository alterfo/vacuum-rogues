#!/usr/bin/env python3
"""
Space Rangers RL Environment — Gym-совместимая среда для обучения с подкреплением.

Использует реальный GameEngine через PyJS (запуск TypeScript из Python).
Агент взаимодействует с игрой через observe/apply_action, получает награды.

Архитектура:
- Observation: 28 признаков (18 base + 6 goal + 4 progress + контекст)
- Action: 10 дискретных действий (move/warp/land/dock/trade/take-quest/attack/flee/repair/wait)
- Reward: композиция выживания, прогресса, исследования, достижений

Usage:
    env = SpaceRangersEnv(seed=42)
    obs = env.reset()
    for t in range(1000):
        action = agent.decide(obs)
        obs, reward, done, info = env.step(action)
        if done: break
"""
from __future__ import annotations

import json
import subprocess
import sys
from dataclasses import dataclass, field
from enum import IntEnum
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

# ============================================================================
# Константы
# ============================================================================

NUM_ACTIONS = 10
OBS_DIM = 28  # 18 base + 6 goal + 4 progress
MAX_STEPS_PER_EPISODE = 2000  # ~1-2 часа игры

# Действия (должно совпадать с ACTION_ORDER в observe.ts)
class ActionType(IntEnum):
    MOVE = 0
    WARP = 1
    LAND = 2
    DOCK = 3
    TRADE = 4
    TAKE_QUEST = 5
    ATTACK = 6
    FLEE = 7
    REPAIR = 8
    WAIT = 9

ACTION_NAMES = ["move", "warp", "land", "dock", "trade", "take-quest", "attack", "flee", "repair", "wait"]

# ============================================================================
# Награды
# ============================================================================

@dataclass
class RewardConfig:
    """Конфигурация функции награды."""
    
    # Выживание (критически важно)
    survival_reward: float = 1.0       # за каждый тик с hull > 50%
    survival_penalty: float = -0.5     # за каждый тик с hull < 30%
    death_penalty: float = -100.0      # смерть корабля
    
    # Прогресс
    credits_reward_scale: float = 0.001    # за заработанные кредиты
    reputation_reward_scale: float = 0.1   # за репутацию
    quest_completion_reward: float = 10.0  # за завершение квеста
    quest_failure_penalty: float = -5.0    # за провал квеста
    
    # Исследование
    system_visited_reward: float = 2.0     # за новую систему
    planet_landed_reward: float = 0.5      # за посадку на планету
    
    # Достижения
    rank_up_reward: float = 20.0       # за повышение ранга
    overmind_stop_reward: float = 50.0 # за остановку Сверхразума
    victory_reward: float = 500.0      # победа в игре
    defeat_penalty: float = -200.0     # поражение (Сверхразум победил)
    
    # Штрафы за плохое поведение
    idle_penalty: float = -0.01        # за каждый тик бездействия
    pointless_jump_penalty: float = -0.1  # за бесцельный прыжок
    low_fuel_penalty: float = -0.5     # за низкий уровень топлива
    
    # Баланс
    discount_factor: float = 0.99      # γ для PPO


DEFAULT_REWARD_CONFIG = RewardConfig()


# ============================================================================
# Observation
# ============================================================================

@dataclass
class Observation:
    """
    Наблюдение агента за состоянием игры.
    
    28 признаков:
    - 18 base: текущее состояние (из NeuralPolicy)
    - 6 goal: one-hot кодирование текущей цели
    - 4 progress: прогресс к цели
    """
    
    # Base features (18)
    scene_type: float = 0.0              # 0=SPACE_FLIGHT, 1=PLANET, 2=STATION, ...
    hull_percent: float = 1.0            # 0..1
    fuel_percent: float = 1.0            # 0..1
    credits_normalized: float = 0.0      # credits / 10000
    cargo_hold_percent: float = 0.0      # 0..1
    rank_normalized: float = 0.0         # rank / 7
    
    # Репутация с фракциями (5 фракций)
    rep_outlanders: float = 0.0          # -1..1 → 0..1
    rep_bastions: float = 0.0
    rep_syndicate: float = 0.0
    rep_paradox: float = 0.0
    rep_progressors: float = 0.0
    
    # Позиция и окружение
    in_hostile_system: float = 0.0       # 1 если система захвачена
    nearest_enemy_distance: float = 1.0  # нормализованное расстояние
    active_quest_type: float = 0.0       # 0=none, 1=delivery, 2=bounty, ...
    quest_deadline_normalized: float = 1.0  # 0..1 (1 = много времени)
    
    # Goal features (6) — one-hot
    goal_earn_money: float = 0.0
    goal_complete_quest: float = 0.0
    goal_explore: float = 0.0
    goal_survive: float = 0.0
    goal_upgrade: float = 0.0
    goal_stop_overmind: float = 0.0
    
    # Progress features (4)
    goal_progress: float = 0.0           # 0..1
    goal_time_elapsed: float = 0.0       # 0..1
    goal_distance: float = 1.0           # нормализованное расстояние до цели
    goal_feasible: float = 1.0           # 0..1 (реально ли достичь)
    
    def to_array(self) -> np.ndarray:
        """Конвертирует в numpy array для нейросети."""
        return np.array([
            # Base (18)
            self.scene_type,
            self.hull_percent,
            self.fuel_percent,
            self.credits_normalized,
            self.cargo_hold_percent,
            self.rank_normalized,
            self.rep_outlanders,
            self.rep_bastions,
            self.rep_syndicate,
            self.rep_paradox,
            self.rep_progressors,
            self.in_hostile_system,
            self.nearest_enemy_distance,
            self.active_quest_type,
            self.quest_deadline_normalized,
            # Placeholder для совместимости (3 признака из memoryFeatures)
            0.0, 0.0, 0.0,
            # Goal (6)
            self.goal_earn_money,
            self.goal_complete_quest,
            self.goal_explore,
            self.goal_survive,
            self.goal_upgrade,
            self.goal_stop_overmind,
            # Progress (4)
            self.goal_progress,
            self.goal_time_elapsed,
            self.goal_distance,
            self.goal_feasible,
        ], dtype=np.float32)
    
    @classmethod
    def zeros(cls) -> 'Observation':
        """Нулевое наблюдение (для инициализации)."""
        return cls()


# ============================================================================
# Environment
# ============================================================================

@dataclass
class EpisodeStats:
    """Статистика эпизода."""
    total_reward: float = 0.0
    steps: int = 0
    credits_earned: float = 0.0
    systems_visited: int = 0
    quests_completed: int = 0
    died: bool = False
    won: bool = False
    overmind_stopped: bool = False


class SpaceRangersEnv:
    """
    Gym-совместимая среда для RL.
    
    Пример использования:
        env = SpaceRangersEnv(seed=42)
        obs = env.reset()
        for t in range(1000):
            action = agent.predict(obs)
            obs, reward, done, info = env.step(action)
            if done:
                print(f"Episode finished: reward={info['total_reward']:.2f}")
                break
    """
    
    def __init__(
        self,
        seed: Optional[int] = None,
        reward_config: RewardConfig = DEFAULT_REWARD_CONFIG,
        max_steps: int = MAX_STEPS_PER_EPISODE,
    ):
        self.seed = seed
        self.reward_config = reward_config
        self.max_steps = max_steps
        
        # Состояние эпизода
        self.step_count = 0
        self.current_obs = Observation.zeros()
        self.stats = EpisodeStats()
        
        # Трекинг для наград
        self.prev_credits = 0.0
        self.prev_reputation: Dict[str, float] = {}
        self.prev_systems_visited = 0
        self.prev_quests_completed = 0
        self.prev_rank = 0
        self.prev_overmind_systems = 0
        
        # Goal tracking
        self.current_goal: Optional[str] = None
        self.goal_start_step = 0
        self.goal_progress = 0.0
        
        print(f"[RL] Environment initialized (seed={seed}, max_steps={max_steps})")
    
    def reset(self) -> np.ndarray:
        """
        Сбрасывает среду, начинает новый эпизод.
        
        Returns:
            Начальное наблюдение (numpy array, shape=(28,))
        """
        self.step_count = 0
        self.stats = EpisodeStats()
        self.current_goal = None
        self.goal_start_step = 0
        self.goal_progress = 0.0
        
        # Запуск новой игры через GameEngine
        game_state = self._start_new_game()
        
        # Инициализация трекинга
        self.prev_credits = game_state.get('credits', 0.0)
        self.prev_reputation = dict(game_state.get('reputation', {}))
        self.prev_systems_visited = len(game_state.get('visitedSystems', []))
        self.prev_quests_completed = len(game_state.get('completedQuests', []))
        self.prev_rank = game_state.get('rank', 0)
        self.prev_overmind_systems = game_state.get('overmindSystemsCount', 0)
        
        # Парсинг наблюдения
        self.current_obs = self._parse_observation(game_state)
        
        print(f"[RL] Episode started (seed={self.seed})")
        
        return self.current_obs.to_array()
    
    def step(self, action: int) -> Tuple[np.ndarray, float, bool, Dict[str, Any]]:
        """
        Выполняет действие в среде.
        
        Args:
            action: индекс действия (0-9)
        
        Returns:
            observation: новое наблюдение
            reward: награда за шаг
            done: завершён ли эпизод
            info: дополнительная информация
        """
        self.step_count += 1
        
        # Применение действия
        action_name = ACTION_NAMES[action]
        game_state = self._apply_action(action_name)
        
        # Парсинг нового наблюдения
        prev_obs = self.current_obs
        self.current_obs = self._parse_observation(game_state)
        
        # Вычисление награды
        reward = self._compute_reward(prev_obs, self.current_obs, game_state, action)
        
        # Обновление статистики
        self.stats.total_reward += reward
        self.stats.steps = self.step_count
        
        # Проверка завершения
        done = self._is_done(game_state)
        
        # Info
        info = {
            'total_reward': self.stats.total_reward,
            'steps': self.step_count,
            'action': action_name,
            'credits': game_state.get('credits', 0),
            'hull_percent': self.current_obs.hull_percent,
            'died': done and self.stats.died,
            'won': done and self.stats.won,
        }
        
        if done:
            print(f"[RL] Episode finished: reward={self.stats.total_reward:.2f}, steps={self.step_count}")
        
        return self.current_obs.to_array(), reward, done, info
    
    def _start_new_game(self) -> Dict[str, Any]:
        """Запускает новую игру через GameEngine."""
        # Пока заглушка — в полной версии будет вызов GameEngine через PyJS
        # или запуск headless-сессии через vitest
        return {
            'credits': 1000.0,
            'hull': 100.0,
            'maxHull': 100.0,
            'fuel': 100.0,
            'maxFuel': 100.0,
            'cargo': 0,
            'maxCargo': 50,
            'rank': 0,
            'reputation': {
                'OUTLANDERS': 0.0,
                'BASTIONS': 0.0,
                'SYNDICATE': 0.0,
                'PARADOX': 0.0,
                'PROGRESSORS': 0.0,
            },
            'currentSystemId': 'sys_0',
            'inHostileSystem': False,
            'activeQuests': [],
            'completedQuests': [],
            'visitedSystems': ['sys_0'],
            'overmindSystemsCount': 2,
            'sceneType': 'SPACE_FLIGHT',
            'nearbyEnemies': [],
        }
    
    def _apply_action(self, action_name: str) -> Dict[str, Any]:
        """
        Применяет действие к GameEngine.
        
        В полной версии:
        - Вызывает PlayerAgent.apply() из TypeScript
        - Или напрямую модифицирует состояние GameEngine
        """
        # Пока заглушка — симуляция простого перехода состояния
        # В реальности: вызов TypeScript через subprocess или PyJS
        state = self._start_new_game()
        state['credits'] = self.prev_credits + 10  # Пример изменения
        return state
    
    def _parse_observation(self, game_state: Dict[str, Any]) -> Observation:
        """Парсит состояние игры в Observation."""
        obs = Observation()
        
        # Scene type
        scene_map = {
            'SPACE_FLIGHT': 0.0,
            'PLANET': 0.2,
            'STATION': 0.4,
            'TRADE': 0.6,
            'COMBAT': 0.8,
            'STAR_MAP': 1.0,
        }
        obs.scene_type = scene_map.get(game_state.get('sceneType', 'SPACE_FLIGHT'), 0.0)
        
        # Hull & fuel
        hull = game_state.get('hull', 100.0)
        max_hull = game_state.get('maxHull', 100.0)
        obs.hull_percent = max(0.0, min(1.0, hull / max_hull)) if max_hull > 0 else 1.0
        
        fuel = game_state.get('fuel', 100.0)
        max_fuel = game_state.get('maxFuel', 100.0)
        obs.fuel_percent = max(0.0, min(1.0, fuel / max_fuel)) if max_fuel > 0 else 1.0
        
        # Credits
        credits = game_state.get('credits', 0.0)
        obs.credits_normalized = max(0.0, min(1.0, credits / 10000.0))
        
        # Cargo
        cargo = game_state.get('cargo', 0)
        max_cargo = game_state.get('maxCargo', 50)
        obs.cargo_hold_percent = max(0.0, min(1.0, cargo / max_cargo)) if max_cargo > 0 else 0.0
        
        # Rank
        rank = game_state.get('rank', 0)
        obs.rank_normalized = max(0.0, min(1.0, rank / 7.0))
        
        # Reputation (5 factions)
        rep = game_state.get('reputation', {})
        obs.rep_outlanders = (rep.get('OUTLANDERS', 0.0) + 100) / 200.0
        obs.rep_bastions = (rep.get('BASTIONS', 0.0) + 100) / 200.0
        obs.rep_syndicate = (rep.get('SYNDICATE', 0.0) + 100) / 200.0
        obs.rep_paradox = (rep.get('PARADOX', 0.0) + 100) / 200.0
        obs.rep_progressors = (rep.get('PROGRESSORS', 0.0) + 100) / 200.0
        
        # Hostile system
        obs.in_hostile_system = 1.0 if game_state.get('inHostileSystem', False) else 0.0
        
        # Enemies
        enemies = game_state.get('nearbyEnemies', [])
        if enemies:
            # Упрощённо: расстояние до ближайшего врага
            obs.nearest_enemy_distance = 0.5  # заглушка
        else:
            obs.nearest_enemy_distance = 1.0
        
        # Quests
        active_quests = game_state.get('activeQuests', [])
        if active_quests:
            quest = active_quests[0]
            quest_type_map = {'DELIVERY': 0.25, 'BOUNTY': 0.5, 'DEFENSE': 0.75, 'EXPLORATION': 1.0}
            obs.active_quest_type = quest_type_map.get(quest.get('type', 'DELIVERY'), 0.25)
            
            deadline = quest.get('deadline', 100)
            current_day = game_state.get('gameDay', 0)
            remaining = max(0, deadline - current_day)
            obs.quest_deadline_normalized = max(0.0, min(1.0, remaining / 100.0))
        else:
            obs.active_quest_type = 0.0
            obs.quest_deadline_normalized = 1.0
        
        # Goal features (one-hot)
        if self.current_goal:
            goal_map = {
                'EARN_MONEY': 0,
                'COMPLETE_QUEST': 1,
                'EXPLORE': 2,
                'SURVIVE': 3,
                'UPGRADE': 4,
                'STOP_OVERMIND': 5,
            }
            goal_idx = goal_map.get(self.current_goal, 0)
            goal_onehot = [0.0] * 6
            goal_onehot[goal_idx] = 1.0
            obs.goal_earn_money = goal_onehot[0]
            obs.goal_complete_quest = goal_onehot[1]
            obs.goal_explore = goal_onehot[2]
            obs.goal_survive = goal_onehot[3]
            obs.goal_upgrade = goal_onehot[4]
            obs.goal_stop_overmind = goal_onehot[5]
        
        # Progress features
        obs.goal_progress = self.goal_progress
        elapsed = self.step_count - self.goal_start_step if self.goal_start_step > 0 else 0
        obs.goal_time_elapsed = max(0.0, min(1.0, elapsed / 500.0))  # 500 шагов на цель
        obs.goal_distance = 1.0 - self.goal_progress  # упрощённо
        obs.goal_feasible = 1.0 if self.goal_progress > 0.01 else 0.5
        
        return obs
    
    def _compute_reward(
        self,
        prev_obs: Observation,
        curr_obs: Observation,
        game_state: Dict[str, Any],
        action: int,
    ) -> float:
        """
        Вычисляет награду за шаг.
        
        Компоненты:
        1. Выживание (hull, смерть)
        2. Прогресс (кредиты, репутация, квесты, ранг)
        3. Исследование (системы, планеты)
        4. Достижения (победа, Сверхразум)
        5. Штрафы (бездействие, глупые действия)
        """
        reward = 0.0
        cfg = self.reward_config
        
        # 1. Выживание
        if curr_obs.hull_percent > 0.5:
            reward += cfg.survival_reward
        elif curr_obs.hull_percent < 0.3:
            reward += cfg.survival_penalty
        
        # Смерть (проверка по game_state)
        if game_state.get('died', False):
            reward += cfg.death_penalty
            self.stats.died = True
        
        # 2. Прогресс
        credits_delta = game_state.get('credits', 0) - self.prev_credits
        if credits_delta > 0:
            reward += credits_delta * cfg.credits_reward_scale
        
        # Репутация
        rep = game_state.get('reputation', {})
        for faction, prev_rep in self.prev_reputation.items():
            delta = rep.get(faction, 0) - prev_rep
            if delta > 0:
                reward += delta * cfg.reputation_reward_scale
        
        # Квесты
        quests_completed = len(game_state.get('completedQuests', []))
        if quests_completed > self.prev_quests_completed:
            reward += cfg.quest_completion_reward
        self.prev_quests_completed = quests_completed
        
        # Ранг
        rank = game_state.get('rank', 0)
        if rank > self.prev_rank:
            reward += cfg.rank_up_reward
        self.prev_rank = rank
        
        # 3. Исследование
        systems_visited = len(game_state.get('visitedSystems', []))
        if systems_visited > self.prev_systems_visited:
            reward += cfg.system_visited_reward
        self.prev_systems_visited = systems_visited
        
        # 4. Достижения
        if game_state.get('won', False):
            reward += cfg.victory_reward
            self.stats.won = True
        
        overmind_count = game_state.get('overmindSystemsCount', 0)
        if overmind_count < self.prev_overmind_systems:
            reward += cfg.overmind_stop_reward
        self.prev_overmind_systems = overmind_count
        
        # 5. Штрафы
        if action == ActionType.WAIT:
            reward += cfg.idle_penalty
        
        if curr_obs.fuel_percent < 0.1:
            reward += cfg.low_fuel_penalty
        
        # Обновление трекинга
        self.prev_credits = game_state.get('credits', 0)
        self.prev_reputation = dict(rep)
        
        return reward
    
    def _is_done(self, game_state: Dict[str, Any]) -> bool:
        """Проверяет завершение эпизода."""
        # Смерть или победа
        if game_state.get('died', False):
            return True
        if game_state.get('won', False):
            return True
        
        # Поражение от Сверхразума
        if game_state.get('lost', False):
            return True
        
        # Максимум шагов
        if self.step_count >= self.max_steps:
            return True
        
        return False
    
    def set_goal(self, goal_type: str) -> None:
        """
        Устанавливает текущую цель для агента.
        
        Args:
            goal_type: одна из 'EARN_MONEY', 'COMPLETE_QUEST', 'EXPLORE', 'SURVIVE', 'UPGRADE', 'STOP_OVERMIND'
        """
        self.current_goal = goal_type
        self.goal_start_step = self.step_count
        self.goal_progress = 0.0
        print(f"[RL] Goal set: {goal_type} at step {self.goal_start_step}")
    
    def update_goal_progress(self, progress: float) -> None:
        """Обновляет прогресс к текущей цели (0..1)."""
        self.goal_progress = max(0.0, min(1.0, progress))
    
    def render(self) -> None:
        """Визуализация (для отладки)."""
        print(f"Step {self.step_count}:")
        print(f"  Hull: {self.current_obs.hull_percent:.2%}")
        print(f"  Credits: {self.current_obs.credits_normalized * 10000:.0f}")
        print(f"  Goal: {self.current_goal or 'none'}")
        print(f"  Goal Progress: {self.goal_progress:.2%}")


# ============================================================================
# Тест среды
# ============================================================================

def test_env():
    """Простой тест среды."""
    print("=" * 60)
    print("Testing SpaceRangersEnv")
    print("=" * 60)
    
    env = SpaceRangersEnv(seed=42)
    obs = env.reset()
    
    print(f"\nInitial observation shape: {obs.shape}")
    print(f"Expected: ({OBS_DIM},)")
    assert obs.shape == (OBS_DIM,), f"Expected shape ({OBS_DIM},), got {obs.shape}"
    
    # Симуляция случайных действий
    total_reward = 0.0
    for i in range(10):
        action = np.random.randint(0, NUM_ACTIONS)
        obs, reward, done, info = env.step(action)
        total_reward += reward
        print(f"Step {i+1}: action={ACTION_NAMES[action]}, reward={reward:.3f}, total={total_reward:.3f}")
        
        if done:
            print(f"Episode ended at step {i+1}")
            break
    
    print(f"\nTotal reward: {total_reward:.3f}")
    print("✓ Environment test passed!")
    return True


if __name__ == "__main__":
    test_env()
