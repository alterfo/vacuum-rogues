#!/usr/bin/env python3
"""
PPO Agent для Space Rangers — Proximal Policy Optimization.

Архитектура:
- Actor: состояние → распределение вероятностей действий
- Critic: состояние → ценность состояния V(s)
- Обучение через PPO loss с clip для стабильности

Использование:
    agent = PPOAgent(input_dim=28, action_dim=10)
    for episode in range(1000):
        trajectory = agent.collect_trajectory(env)
        loss = agent.update(trajectory)
"""
from __future__ import annotations

import argparse
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
import torch.optim as optim
from torch.distributions import Categorical

# ============================================================================
# Конфигурация PPO
# ============================================================================

@dataclass
class PPOConfig:
    """Параметры PPO."""
    
    # Архитектура
    hidden_dim: int = 128
    actor_layers: int = 2
    critic_layers: int = 2
    
    # Обучение
    lr: float = 3e-4
    gamma: float = 0.99          # discount factor
    gae_lambda: float = 0.95     # для Generalized Advantage Estimation
    clip_epsilon: float = 0.2    # PPO clip
    c1: float = 0.5              # коэффициент для value loss
    c2: float = 0.01             # коэффициент для entropy bonus
    max_grad_norm: float = 0.5   # для gradient clipping
    
    # PPO update
    epochs_per_update: int = 10
    batch_size: int = 64
    normalize_advantage: bool = True
    
    # Сходимость
    target_kl: float = 0.02      # early stopping если KL > target
    entropy_coeff_decay: float = 0.9999  # decay для entropy bonus


DEFAULT_PPO_CONFIG = PPOConfig()


# ============================================================================
# Actor-Critic Network
# ============================================================================

class ActorCritic(nn.Module):
    """
    Actor-Critic сеть для PPO.
    
    Actor: состояние → распределение действий (policy)
    Critic: состояние → ценность состояния (value)
    """
    
    def __init__(
        self,
        input_dim: int,
        action_dim: int,
        hidden_dim: int = 128,
        actor_layers: int = 2,
        critic_layers: int = 2,
    ):
        super().__init__()
        
        self.input_dim = input_dim
        self.action_dim = action_dim
        
        # Общие слои (shared backbone)
        shared_layers = []
        prev_dim = input_dim
        for _ in range(2):  # 2 shared layers
            shared_layers.extend([
                nn.Linear(prev_dim, hidden_dim),
                nn.Tanh(),
            ])
            prev_dim = hidden_dim
        self.shared = nn.Sequential(*shared_layers)
        
        # Actor head
        actor_layers_list = []
        prev_dim = hidden_dim
        for i in range(actor_layers):
            actor_layers_list.extend([
                nn.Linear(prev_dim, hidden_dim // 2),
                nn.Tanh(),
            ])
            prev_dim = hidden_dim // 2
        actor_layers_list.append(nn.Linear(prev_dim, action_dim))
        self.actor_head = nn.Sequential(*actor_layers_list)
        
        # Critic head
        critic_layers_list = []
        prev_dim = hidden_dim
        for i in range(critic_layers):
            critic_layers_list.extend([
                nn.Linear(prev_dim, hidden_dim // 2),
                nn.Tanh(),
            ])
            prev_dim = hidden_dim // 2
        critic_layers_list.append(nn.Linear(prev_dim, 1))
        self.critic_head = nn.Sequential(*critic_layers_list)
        
        # Инициализация весов
        self._init_weights()
    
    def _init_weights(self):
        """Инициализация ортогональными весами (лучше для RL)."""
        for module in self.modules():
            if isinstance(module, nn.Linear):
                nn.init.orthogonal_(module.weight, gain=np.sqrt(2))
                nn.init.constant_(module.bias, 0)
        
        # Последний слой actor — маленькие веса (чтобы policy была ближе к равномерной)
        nn.init.orthogonal_(self.actor_head[-1].weight, gain=0.01)
    
    def forward(
        self,
        x: torch.Tensor,
    ) -> Tuple[torch.Tensor, torch.Tensor]:
        """
        Прямой проход.
        
        Returns:
            action_logits: логиты действий (batch_size, action_dim)
            value: ценность состояния (batch_size, 1)
        """
        shared = self.shared(x)
        action_logits = self.actor_head(shared)
        value = self.critic_head(shared)
        return action_logits, value
    
    def get_action(
        self,
        x: torch.Tensor,
        deterministic: bool = False,
    ) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """
        Выбор действия.
        
        Returns:
            action: выбранное действие
            log_prob: логарифм вероятности
            entropy: энтропия распределения
        """
        action_logits, value = self.forward(x)
        
        dist = Categorical(logits=action_logits)
        
        if deterministic:
            action = action_logits.argmax(dim=-1)
        else:
            action = dist.sample()
        
        log_prob = dist.log_prob(action)
        entropy = dist.entropy()
        
        return action, log_prob, entropy
    
    def evaluate_actions(
        self,
        x: torch.Tensor,
        actions: torch.Tensor,
    ) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """
        Оценка действий (для PPO update).
        
        Returns:
            log_prob: логарифм вероятности данных действий
            entropy: энтропия
            value: ценность состояния
        """
        action_logits, value = self.forward(x)
        
        dist = Categorical(logits=action_logits)
        log_prob = dist.log_prob(actions)
        entropy = dist.entropy()
        
        return log_prob, entropy, value


# ============================================================================
# PPO Agent
# ============================================================================

@dataclass
class TrajectorySample:
    """Один шаг траектории."""
    state: np.ndarray
    action: int
    reward: float
    log_prob: float
    value: float
    done: bool


class PPOAgent:
    """
    PPO-агент для обучения политике.
    """
    
    def __init__(
        self,
        input_dim: int,
        action_dim: int,
        config: PPOConfig = DEFAULT_PPO_CONFIG,
        device: Optional[str] = None,
    ):
        self.input_dim = input_dim
        self.action_dim = action_dim
        self.config = config
        
        # Device
        if device is None:
            self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        else:
            self.device = torch.device(device)
        
        print(f"[PPO] Using device: {self.device}")
        
        # Модель
        self.model = ActorCritic(
            input_dim=input_dim,
            action_dim=action_dim,
            hidden_dim=config.hidden_dim,
            actor_layers=config.actor_layers,
            critic_layers=config.critic_layers,
        ).to(self.device)
        
        # Оптимизатор
        self.optimizer = optim.Adam(self.model.parameters(), lr=config.lr)
        
        # Статистика
        self.total_updates = 0
        self.entropy_coeff = self.config.c2
    
    def select_action(
        self,
        state: np.ndarray,
        deterministic: bool = False,
    ) -> Tuple[int, float, float]:
        """
        Выбор действия для данного состояния.
        
        Args:
            state: наблюдение (input_dim,)
            deterministic: если True, выбирает действие с макс. вероятностью
        
        Returns:
            action: индекс действия
            log_prob: логарифм вероятности
            value: ценность состояния
        """
        with torch.no_grad():
            x = torch.FloatTensor(state).unsqueeze(0).to(self.device)
            action, log_prob, entropy = self.model.get_action(x, deterministic)
            _, value = self.model.forward(x)
        
        return (
            action.item(),
            log_prob.item(),
            value.squeeze().item(),
        )
    
    def collect_trajectory(
        self,
        env,
        n_steps: int,
    ) -> List[TrajectorySample]:
        """
        Сбор траектории из n шагов.
        
        Args:
            env: SpaceRangersEnv
            n_steps: количество шагов
        
        Returns:
            траектория из n_samples
        """
        trajectory = []
        state = env.reset()
        
        for _ in range(n_steps):
            action, log_prob, value = self.select_action(state)
            
            next_state, reward, done, info = env.step(action)
            
            trajectory.append(TrajectorySample(
                state=state.copy(),
                action=action,
                reward=reward,
                log_prob=log_prob,
                value=value,
                done=done,
            ))
            
            state = next_state
            if done:
                state = env.reset()
        
        return trajectory
    
    def compute_gae(
        self,
        rewards: List[float],
        values: List[float],
        dones: List[bool],
    ) -> Tuple[List[float], List[float]]:
        """
        Generalized Advantage Estimation.
        
        Returns:
            advantages: advantage для каждого шага
            returns: discounted returns
        """
        advantages = []
        returns = []
        
        gae = 0.0
        next_value = 0.0
        
        for t in reversed(range(len(rewards))):
            delta = rewards[t] + self.config.gamma * next_value * (1 - dones[t]) - values[t]
            gae = delta + self.config.gamma * self.config.gae_lambda * (1 - dones[t]) * gae
            advantages.insert(0, gae)
            returns.insert(0, gae + values[t])
            next_value = values[t]
        
        return advantages, returns
    
    def update(self, trajectory: List[TrajectorySample]) -> Dict[str, float]:
        """
        PPO update по собранной траектории.
        
        Args:
            trajectory: список TrajectorySample
        
        Returns:
            словарь с метриками обучения
        """
        if len(trajectory) == 0:
            return {'loss': 0.0}
        
        # Конвертация в тензоры
        states = torch.FloatTensor(np.array([t.state for t in trajectory])).to(self.device)
        actions = torch.LongTensor([t.action for t in trajectory]).to(self.device)
        rewards = torch.FloatTensor([t.reward for t in trajectory]).to(self.device)
        old_log_probs = torch.FloatTensor([t.log_prob for t in trajectory]).to(self.device)
        values = torch.FloatTensor([t.value for t in trajectory]).squeeze().to(self.device)
        dones = torch.BoolTensor([t.done for t in trajectory]).to(self.device)
        
        # GAE
        advantages, returns = self.compute_gae(
            rewards.tolist(),
            values.tolist(),
            dones.tolist(),
        )
        advantages = torch.FloatTensor(advantages).to(self.device)
        returns = torch.FloatTensor(returns).to(self.device)
        
        # Нормализация advantages
        if self.config.normalize_advantage:
            advantages = (advantages - advantages.mean()) / (advantages.std() + 1e-8)
        
        # PPO update
        total_loss = 0.0
        total_policy_loss = 0.0
        total_value_loss = 0.0
        total_entropy = 0.0
        
        for epoch in range(self.config.epochs_per_update):
            # Перемешивание данных
            indices = torch.randperm(len(trajectory))
            
            for start in range(0, len(trajectory), self.config.batch_size):
                end = start + self.config.batch_size
                batch_indices = indices[start:end]
                
                batch_states = states[batch_indices]
                batch_actions = actions[batch_indices]
                batch_old_log_probs = old_log_probs[batch_indices]
                batch_advantages = advantages[batch_indices]
                batch_returns = returns[batch_indices]
                
                # Forward pass
                log_probs, entropy, values = self.model.evaluate_actions(
                    batch_states, batch_actions
                )
                values = values.squeeze()
                
                # Policy loss (PPO clip)
                ratios = torch.exp(log_probs - batch_old_log_probs)
                surr1 = ratios * batch_advantages
                surr2 = torch.clamp(
                    ratios, 1 - self.config.clip_epsilon, 1 + self.config.clip_epsilon
                ) * batch_advantages
                policy_loss = -torch.min(surr1, surr2).mean()
                
                # Value loss
                value_loss = F.mse_loss(values, batch_returns)
                
                # Entropy bonus (для исследования)
                entropy_loss = -entropy.mean()
                
                # Total loss
                loss = (
                    policy_loss +
                    self.config.c1 * value_loss +
                    self.entropy_coeff * entropy_loss
                )
                
                # Backward
                self.optimizer.zero_grad()
                loss.backward()
                
                # Gradient clipping
                nn.utils.clip_grad_norm_(self.model.parameters(), self.config.max_grad_norm)
                
                self.optimizer.step()
                
                # Статистика
                total_loss += loss.item()
                total_policy_loss += policy_loss.item()
                total_value_loss += value_loss.item()
                total_entropy += entropy.mean().item()
        
        # Update счетчики
        n_updates = self.config.epochs_per_update * (len(trajectory) // self.config.batch_size)
        self.total_updates += n_updates
        
        # Decay entropy coefficient
        self.entropy_coeff *= self.config.entropy_coeff_decay
        
        # Метрики
        metrics = {
            'loss': total_loss / n_updates,
            'policy_loss': total_policy_loss / n_updates,
            'value_loss': total_value_loss / n_updates,
            'entropy': total_entropy / n_updates,
            'entropy_coeff': self.entropy_coeff,
        }
        
        return metrics
    
    def save(self, path: str) -> None:
        """Сохраняет модель."""
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        torch.save({
            'model_state_dict': self.model.state_dict(),
            'optimizer_state_dict': self.optimizer.state_dict(),
            'total_updates': self.total_updates,
            'entropy_coeff': self.entropy_coeff,
            'config': self.config,
        }, path)
        print(f"[PPO] Model saved to {path}")
    
    def load(self, path: str) -> None:
        """Загружает модель."""
        checkpoint = torch.load(path, map_location=self.device)
        self.model.load_state_dict(checkpoint['model_state_dict'])
        self.optimizer.load_state_dict(checkpoint['optimizer_state_dict'])
        self.total_updates = checkpoint['total_updates']
        self.entropy_coeff = checkpoint['entropy_coeff']
        print(f"[PPO] Model loaded from {path}")
    
    def export_weights_json(self, path: str) -> None:
        """
        Экспортирует веса в JSON формате (совместимом с TypeScript MLP).
        """
        layers = []
        
        for name, module in self.model.named_modules():
            if isinstance(module, nn.Linear):
                layers.append({
                    'W': module.weight.detach().cpu().tolist(),
                    'b': module.bias.detach().cpu().tolist(),
                })
        
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with open(path, 'w') as f:
            json.dump({'layers': layers}, f, indent=2)
        
        print(f"[PPO] Weights exported to {path}")


# ============================================================================
# Training Loop
# ============================================================================

def train_ppo(
    env,
    agent: PPOAgent,
    episodes: int = 1000,
    steps_per_episode: int = 500,
    save_path: Optional[str] = None,
    log_interval: int = 10,
) -> List[Dict[str, float]]:
    """
    Обучение PPO-агента.
    
    Args:
        env: SpaceRangersEnv
        agent: PPOAgent
        episodes: количество эпизодов
        steps_per_episode: шагов на эпизод
        save_path: путь для сохранения модели
        log_interval: интервал логгирования
    
    Returns:
        история обучения
    """
    history = []
    best_reward = -float('inf')
    
    print(f"[PPO] Starting training: {episodes} episodes, {steps_per_episode} steps/episode")
    
    for episode in range(episodes):
        # Сбор траектории
        trajectory = agent.collect_trajectory(env, steps_per_episode)
        
        # PPO update
        metrics = agent.update(trajectory)
        
        # Статистика эпизода
        total_reward = sum(t.reward for t in trajectory)
        episode_length = len(trajectory)
        
        metrics['episode'] = episode
        metrics['total_reward'] = total_reward
        metrics['episode_length'] = episode_length
        
        history.append(metrics)
        
        # Логгирование
        if episode % log_interval == 0 or episode == episodes - 1:
            print(f"Episode {episode:4d}: "
                  f"reward={total_reward:7.2f}, "
                  f"length={episode_length:4d}, "
                  f"loss={metrics['loss']:.4f}, "
                  f"entropy={metrics['entropy']:.4f}")
        
        # Сохранение лучшей модели
        if save_path and total_reward > best_reward:
            best_reward = total_reward
            agent.save(save_path)
            print(f"  → New best reward: {best_reward:.2f}, model saved")
    
    return history


# ============================================================================
# CLI
# ============================================================================

def main():
    parser = argparse.ArgumentParser(description='Train PPO agent for Space Rangers')
    parser.add_argument('--episodes', type=int, default=1000, help='Number of episodes')
    parser.add_argument('--steps', type=int, default=500, help='Steps per episode')
    parser.add_argument('--hidden', type=int, default=128, help='Hidden dimension')
    parser.add_argument('--lr', type=float, default=3e-4, help='Learning rate')
    parser.add_argument('--gamma', type=float, default=0.99, help='Discount factor')
    parser.add_argument('--seed', type=int, default=0, help='Random seed')
    parser.add_argument('--save', type=str, default='ppo_model.pt', help='Save path')
    parser.add_argument('--export', type=str, help='Export weights to JSON')
    
    args = parser.parse_args()
    
    # Seed
    torch.manual_seed(args.seed)
    np.random.seed(args.seed)
    
    # Import env
    from rl_env import SpaceRangersEnv
    
    # Create env
    env = SpaceRangersEnv(seed=args.seed)
    
    # Create agent
    config = PPOConfig(
        hidden_dim=args.hidden,
        lr=args.lr,
        gamma=args.gamma,
    )
    agent = PPOAgent(
        input_dim=28,
        action_dim=10,
        config=config,
    )
    
    # Train
    history = train_ppo(
        env,
        agent,
        episodes=args.episodes,
        steps_per_episode=args.steps,
        save_path=args.save,
        log_interval=50,
    )
    
    # Export
    if args.export:
        agent.export_weights_json(args.export)
    
    print("\nTraining complete!")
    print(f"Final avg reward: {np.mean([h['total_reward'] for h in history[-100:]]):.2f}")


if __name__ == "__main__":
    main()
