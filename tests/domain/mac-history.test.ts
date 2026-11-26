import { describe, expect, it } from 'vitest';
import { macHistory } from '@/lib/domain/mac-history';
import type { Project, Repo } from '@/lib/domain/types';
import { job } from '../helpers/factories';

const NOW = new Date('2026-11-26T12:00:00Z'); // 17:00 in Almaty
const projects: Project[] = [{ id: 'p1', name: 'Tenra' }, { id: 'p2', name: 'Platina' }];
const repos: Repo[] = [
  { fullName: 'o/Tenra', projectId: 'p1', defaultBranch: 'main' },
  { fullName: 'o/Platina', projectId: 'p2', defaultBranch: 'main' },
];
const done = (repo: string, created: string, started: string, completed: string, labels = ['macos-26']) =>
  job({ repo, labels, status: 'completed', createdAt: new Date(created), startedAt: new Date(started), completedAt: new Date(completed) });

describe('macHistory', () => {
  it('gives the last 14 days in the timezone of the owner, oldest first, empty days included', () => {
    const h = macHistory([], repos, projects, NOW, 'Asia/Almaty');
    expect(h.days).toHaveLength(14);
    expect(h.days[0]).toMatchObject({ date: '2026-11-13', label: '13.11', waitMin: 0, minutes: {} });
    expect(h.days[13]?.date).toBe('2026-11-26');
    expect(h.projects).toEqual([]);
  });

  it('sums build minutes by project and waiting minutes by day', () => {
    const h = macHistory(
      [
        done('o/Tenra', '2026-11-26T05:00:00Z', '2026-11-26T05:30:00Z', '2026-11-26T06:10:00Z'),
        done('o/Tenra', '2026-11-26T07:00:00Z', '2026-11-26T07:00:00Z', '2026-11-26T07:20:30Z'),
        done('o/Platina', '2026-11-25T10:00:00Z', '2026-11-25T10:10:00Z', '2026-11-25T10:22:00Z'),
      ],
      repos, projects, NOW, 'Asia/Almaty',
    );
    expect(h.days[13]).toMatchObject({ minutes: { Tenra: 61 }, waitMin: 30 });
    expect(h.days[12]).toMatchObject({ minutes: { Platina: 12 }, waitMin: 10 });
    expect(h.projects).toEqual(['Tenra', 'Platina']);
  });

  it('puts a build on the day it finished where the owner lives', () => {
    // 20:30 UTC on the 25th is 01:30 on the 26th in Almaty.
    const h = macHistory([done('o/Tenra', '2026-11-25T20:00:00Z', '2026-11-25T20:00:00Z', '2026-11-25T20:30:00Z')], repos, projects, NOW, 'Asia/Almaty');
    expect(h.days[13]?.minutes).toEqual({ Tenra: 30 });
    expect(h.days[12]?.minutes).toEqual({});
  });

  it('leaves out other runners, unfinished jobs, jobs that never started and days before the window', () => {
    const h = macHistory(
      [
        done('o/Tenra', '2026-11-26T05:00:00Z', '2026-11-26T05:00:00Z', '2026-11-26T05:10:00Z', ['ubuntu-latest']),
        job({ repo: 'o/Tenra', labels: ['macos-26'], status: 'completed', createdAt: new Date('2026-11-26T05:00:00Z'), startedAt: null, completedAt: new Date('2026-11-26T05:01:00Z') }),
        job({ repo: 'o/Tenra', labels: ['macos-26'], status: 'in_progress', createdAt: new Date('2026-11-26T05:00:00Z'), startedAt: new Date('2026-11-26T05:00:00Z'), completedAt: null }),
        done('o/Tenra', '2026-11-01T05:00:00Z', '2026-11-01T05:00:00Z', '2026-11-01T05:10:00Z'),
      ],
      repos, projects, NOW, 'Asia/Almaty',
    );
    expect(h.days.every((d) => Object.keys(d.minutes).length === 0 && d.waitMin === 0)).toBe(true);
  });

  it('names a repository it does not know by its own name', () => {
    const h = macHistory([done('o/Other', '2026-11-26T05:00:00Z', '2026-11-26T05:00:00Z', '2026-11-26T05:10:00Z')], repos, projects, NOW, 'Asia/Almaty');
    expect(h.days[13]?.minutes).toEqual({ Other: 10 });
  });
});
