#include <stdio.h>
int main(void) {
    int n = 0;
    int values[1] = {0};
    int sum = 0;
    for (int i = 0; i < n; i = i + 1) {
        sum = sum + values[i];
    }
    printf("%d\n", sum);
    return 0;
}
