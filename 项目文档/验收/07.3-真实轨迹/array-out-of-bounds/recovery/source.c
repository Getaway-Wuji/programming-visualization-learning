#include <stdio.h>
int main(void) {
    int n = 4;
    int values[4] = {-2, 5, 5, 0};
    int sum = 0;
    for (int i = 0; i < n; i = i + 1) {
        sum = sum + values[i];
    }
    printf("%d\n", sum);
    return 0;
}
