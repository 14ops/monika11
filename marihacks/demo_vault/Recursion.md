---
tags: [cs, fundamentals]
---

# Recursion

A recursive function calls itself with a smaller subproblem until it hits a base case.

## Base case

The condition that stops the recursion. Without it, the stack overflows.

## Recursive case

The step that reduces the problem size and hands off to the same function.

## Classic example: factorial

```python
def fact(n):
    if n <= 1:
        return 1
    return n * fact(n - 1)
```

## Where my understanding breaks

I understand the base case but I keep getting confused on how the stack unwinds. I drew a trace on paper for fact(4) and it helps, but I still struggle with mutual recursion.
