#include <stdio.h>
int factorial(int n) {
    if (n <= 1) { return 1; }
    int saved = n;
    int child = factorial(n - 1);
    return saved * child;
}
int change(int n) {
    n = 99;
    return n;
}
int main(void) {
    int n = 5;
    int changed = change(n);
    int result = factorial(n);
    printf("%d %d %d\n", n, changed, result);
    return 0;
}
