# C parser regression programs

## REF-01

```c
#include <stdio.h>
int main(void) {
    int x = 7;
    printf("%d\n", x);
    return 0;
}
```

## REF-02

```c
#include <stdio.h>
int main(void) {
    int x = 7;
    int result = (2 * x) + 3;
    printf("%d\n", result);
    return 0;
}
```

## REF-03

```c
#include <stdio.h>
int main(void) {
    int x = -3;
    if (x >= 0) {
        printf("1\n");
    } else {
        printf("0\n");
    }
    return 0;
}
```

## REF-04

```c
#include <stdio.h>
int main(void) {
    int n = 5;
    int i = 1;
    int sumWhile = 0;
    while (i <= n) {
        sumWhile = sumWhile + i;
        i = i + 1;
    }
    int sumFor = 0;
    for (int j = 1; j <= n; j = j + 1) {
        sumFor = sumFor + j;
    }
    printf("%d\n%d\n", sumWhile, sumFor);
    return 0;
}
```

## REF-05

```c
#include <stdio.h>
int main(void) {
    int n = 3;
    int values[3] = {4, 0, -2};
    int k = 1;
    values[k] = values[k] + 1;
    printf("%d\n", values[k]);
    return 0;
}
```

## REF-06

```c
#include <stdio.h>
int main(void) {
    int n = 3;
    int values[3] = {3, -1, 2};
    int sum = 0;
    for (int i = 0; i < n; i = i + 1) {
        sum = sum + values[i];
    }
    printf("%d\n", sum);
    return 0;
}
```

## REF-07

```c
#include <stdio.h>
int main(void) {
    int x = 3;
    x = x + 2;
    printf("%d\n", x);
    return 0;
}
```

## REF-08

```c
#include <stdio.h>
int main(void) {
    int n = 3;
    int values[3] = {3, 1, 2};
    for (int end = n - 1; end > 0; end = end - 1) {
        for (int j = 0; j < end; j = j + 1) {
            if (values[j] > values[j + 1]) {
                int temp = values[j];
                values[j] = values[j + 1];
                values[j + 1] = temp;
            }
        }
    }
    for (int i = 0; i < n; i = i + 1) {
        if (i > 0) {
            printf(" ");
        }
        printf("%d", values[i]);
    }
    printf("\n");
    return 0;
}
```

## REF-09

```c
#include <stdio.h>
int main(void) {
    int n = 3;
    int values[3] = {3, 1, 2};
    for (int i = 0; i < n - 1; i = i + 1) {
        int minIndex = i;
        for (int j = i + 1; j < n; j = j + 1) {
            if (values[j] < values[minIndex]) {
                minIndex = j;
            }
        }
        if (minIndex != i) {
            int temp = values[i];
            values[i] = values[minIndex];
            values[minIndex] = temp;
        }
    }
    for (int k = 0; k < n; k = k + 1) {
        if (k > 0) {
            printf(" ");
        }
        printf("%d", values[k]);
    }
    printf("\n");
    return 0;
}
```

## REF-10

```c
#include <stdio.h>
int main(void) {
    int n = 5;
    int values[5] = {-2, 0, 0, 4, 8};
    int target = 0;
    int left = 0;
    int right = n - 1;
    int answer = -1;
    while (left <= right) {
        int mid = left + (right - left) / 2;
        if (values[mid] >= target) {
            if (values[mid] == target) {
                answer = mid;
            }
            right = mid - 1;
        } else {
            left = mid + 1;
        }
    }
    printf("%d\n", answer);
    return 0;
}
```
