#include <stdio.h>
int main(void) {
    int n = 30;
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
