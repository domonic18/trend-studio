import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  checkStepGate,
  isGateEnforced,
  nextAttempt,
  planSectionSteps,
} from '../lib/host/production-steps.js'

test('planSectionSteps：第一个未完成的步骤就是当前该做的一步', () => {
  const plan = planSectionSteps([
    { step: 'case_stocks', status: 'done' },
    { step: 'quotes_sync', status: 'done' },
    { step: 'quotes_read', status: 'running' },
  ])
  assert.equal(plan.currentStep, 'quotes_read')
  assert.equal(plan.currentLabel, '行情读回')
  assert.deepEqual(plan.completed, ['case_stocks', 'quotes_sync'])
  assert.deepEqual(plan.blocked, ['figures', 'replay_widget', 'article', 'widgets', 'review', 'provenance'])
})

test('planSectionSteps：全 done 即已定稿；空任务从第一步起步', () => {
  const done = planSectionSteps([
    { step: 'case_stocks', status: 'done' },
    { step: 'quotes_sync', status: 'done' },
    { step: 'quotes_read', status: 'done' },
    { step: 'figures', status: 'done' },
    { step: 'replay_widget', status: 'done' },
    { step: 'article', status: 'done' },
    { step: 'widgets', status: 'done' },
    { step: 'review', status: 'done' },
    { step: 'provenance', status: 'done' },
  ])
  assert.equal(done.currentStep, null)
  assert.equal(done.currentLabel, '已定稿')

  const empty = planSectionSteps([])
  assert.equal(empty.currentStep, 'case_stocks')
  assert.equal(empty.currentLabel, '案例股')
})

test('checkStepGate：前置未完成时挡住，并指出当前该做第几步', () => {
  const tasks = [
    { step: 'case_stocks', status: 'done' },
    { step: 'quotes_sync', status: 'failed' },
  ]
  const gate = checkStepGate(tasks, 'article')
  assert.equal(gate.ok, false)
  assert.match(gate.message, /第 2 步/)
  assert.match(gate.message, /行情同步/)
  assert.match(gate.message, /正文/)
})

test('checkStepGate：前置全完成即放行', () => {
  const tasks = [{ step: 'case_stocks', status: 'done' }]
  const gate = checkStepGate(tasks, 'quotes_sync')
  assert.equal(gate.ok, true)
})

test('isGateEnforced：只有 running/done 受顺序约束', () => {
  assert.equal(isGateEnforced('running'), true)
  assert.equal(isGateEnforced('done'), true)
  assert.equal(isGateEnforced('pending'), false)
  assert.equal(isGateEnforced('blocked'), false)
  assert.equal(isGateEnforced('failed'), false)
})

test('nextAttempt：首次开始记 1，失败后重跑加 1，其余沿用', () => {
  assert.equal(nextAttempt(undefined, 'running'), 1)
  assert.equal(nextAttempt({ status: 'failed', attempt: 1 }, 'running'), 2)
  assert.equal(nextAttempt({ status: 'running', attempt: 2 }, 'running'), 2)
  assert.equal(nextAttempt({ status: 'running', attempt: 2 }, 'done'), 2)
})
